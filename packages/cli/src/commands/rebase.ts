import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yoctoSpinner from 'yocto-spinner';
import { getAIAgentTool, type AIAgentTool } from '../lib/agents/index.js';
import {
  AI_AGENT,
  Git,
  ProjectConfigManager,
  UserSettingsManager,
  showDiff,
  showTitle,
  showProperties,
  showList,
} from 'rover-core';
import { TaskNotFoundError } from 'rover-schemas';
import { executeHooks } from '../lib/hooks.js';
import { getTelemetry } from '../lib/telemetry.js';
import { exitWithError, exitWithSuccess, exitWithWarn } from '../utils/exit.js';
import type { TaskRebaseOutput } from '../output-types.js';
import { isJsonMode, requireProjectContext } from '../lib/context.js';
import type { CommandDefinition } from '../types.js';

const { prompt } = enquirer;

/**
 * AI-powered rebase conflict resolver.
 *
 * Provides the AI with context from both sides of the conflict:
 * - The task branch commits (our side, being rebased)
 * - The onto branch commits (their side, we're rebasing onto)
 *
 * This allows the AI to understand the intent behind both sets of changes
 * and produce a proper resolution.
 */
const resolveRebaseConflicts = async (
  git: Git,
  conflictedFiles: string[],
  aiAgent: AIAgentTool,
  worktreePath: string,
  ontoBranch: string
): Promise<{ success: boolean; failureReason?: string }> => {
  let spinner;

  if (!isJsonMode()) {
    spinner = yoctoSpinner({ text: 'Analyzing rebase conflicts...' }).start();
  }

  try {
    // Gather context from both sides of the conflict.
    // During a rebase, HEAD is detached so getCurrentBranch returns 'unknown'.
    // Use 'HEAD' directly to get recent commits from the current position (task branch).
    const currentBranchName = git.getCurrentBranch({ worktreePath });
    const taskBranchCommits = git
      .getRecentCommits({
        branch: currentBranchName === 'unknown' ? 'HEAD' : currentBranchName,
        worktreePath,
      })
      .join('\n');

    // Get commits from the branch we are rebasing onto for the other side's context.
    const ontoBranchCommits = git
      .getRecentCommits({
        branch: ontoBranch,
        worktreePath,
      })
      .join('\n');

    const diffContext = [
      'Task branch (ours — the changes being rebased):',
      taskBranchCommits,
      '',
      `Target branch "${ontoBranch}" (theirs — the branch we are rebasing onto):`,
      ontoBranchCommits,
    ].join('\n');

    for (const filePath of conflictedFiles) {
      if (spinner) {
        spinner.text = `Resolving conflicts in ${filePath}...`;
      }

      const fullPath = join(worktreePath, filePath);

      if (!existsSync(fullPath)) {
        spinner?.error(`File ${filePath} not found, skipping...`);
        continue;
      }

      const conflictedContent = readFileSync(fullPath, 'utf8');

      try {
        const resolvedContent = await aiAgent.resolveMergeConflicts(
          filePath,
          diffContext,
          conflictedContent
        );

        if (!resolvedContent) {
          const reason = `AI returned empty resolution for ${filePath}`;
          spinner?.error(reason);
          return { success: false, failureReason: reason };
        }

        writeFileSync(fullPath, resolvedContent);

        if (!git.add(filePath, { worktreePath })) {
          const reason = `Error adding ${filePath} to the git commit`;
          spinner?.error(reason);
          return { success: false, failureReason: reason };
        }
      } catch (error) {
        const reason = `Error resolving ${filePath}: ${error}`;
        spinner?.error(reason);
        return { success: false, failureReason: reason };
      }
    }

    spinner?.success('All conflicts resolved by AI');
    return { success: true };
  } catch (error) {
    const reason = `Failed to resolve rebase conflicts: ${error}`;
    spinner?.error(reason);
    return { success: false, failureReason: reason };
  }
};

interface RebaseOptions {
  force?: boolean;
  commit?: boolean;
  json?: boolean;
  onto?: string;
  ontoTask?: string;
}

/**
 * Rebase a task's worktree branch onto the current branch (or another task's branch).
 *
 * Rebases the task branch onto the target branch, using AI-powered conflict
 * resolution when conflicts arise. The AI receives context from both sides
 * of the conflict to make informed resolutions. Updates the task's baseCommit
 * after a successful rebase. Triggers onRebase hooks after successful rebases.
 *
 * Both the main repo and the task worktree must have no uncommitted changes.
 *
 * @param taskId - The numeric task ID to rebase
 * @param options - Command options
 * @param options.force - Skip confirmation prompt
 * @param options.json - Output results in JSON format
 * @param options.onto - A branch name to rebase onto (defaults to current branch)
 * @param options.ontoTask - Another task ID whose branch to rebase onto
 */
const rebaseCommand = async (taskId: string, options: RebaseOptions = {}) => {
  const telemetry = getTelemetry();
  const jsonOutput: TaskRebaseOutput = {
    success: false,
  };

  // Convert string taskId to number
  const numericTaskId = parseInt(taskId, 10);
  if (isNaN(numericTaskId)) {
    jsonOutput.error = `Invalid task ID '${taskId}' - must be a number`;
    await exitWithError(jsonOutput, { telemetry });
    return;
  }

  // Require project context
  let project;
  try {
    project = await requireProjectContext();
  } catch (error) {
    jsonOutput.error = error instanceof Error ? error.message : String(error);
    await exitWithError(jsonOutput, { telemetry });
    return;
  }

  const git = new Git({ cwd: project.path });

  if (!git.isGitRepo()) {
    jsonOutput.error = 'Not a git repository';
    await exitWithError(jsonOutput, { telemetry });
    return;
  }

  jsonOutput.taskId = numericTaskId;

  // Load AI agent selection from user settings
  let selectedAiAgent = 'claude'; // default
  let projectConfig;

  // Load config
  projectConfig = ProjectConfigManager.load(project.path);

  // Load user preferences
  try {
    if (UserSettingsManager.exists(project.path)) {
      const userSettings = UserSettingsManager.load(project.path);
      selectedAiAgent = userSettings.defaultAiAgent || AI_AGENT.Claude;
    } else {
      if (!isJsonMode()) {
        console.log(
          colors.yellow('⚠ User settings not found, defaulting to Claude')
        );
        console.log(
          colors.gray('  Run `rover init` to configure AI agent preferences')
        );
      }
    }
  } catch (error) {
    if (!isJsonMode()) {
      console.log(
        colors.yellow('⚠ Could not load user settings, defaulting to Claude')
      );
    }
    selectedAiAgent = AI_AGENT.Claude;
  }

  // Create AI agent instance
  const aiAgent = getAIAgentTool(selectedAiAgent);

  try {
    // Load task using ProjectManager
    const task = project.getTask(numericTaskId);
    if (!task) {
      throw new TaskNotFoundError(numericTaskId);
    }

    jsonOutput.taskTitle = task.title;
    jsonOutput.branchName = task.branchName;

    // Resolve the branch to rebase onto
    let ontoBranch: string;

    if (options.onto && options.ontoTask) {
      jsonOutput.error =
        'Cannot specify both --onto and --onto-task at the same time';
      await exitWithError(jsonOutput, { telemetry });
      return;
    }

    let ontoTask: ReturnType<typeof project.getTask> | undefined;

    if (options.ontoTask) {
      // --onto-task <taskId>: rebase onto another task's branch
      const ontoTaskId = parseInt(options.ontoTask, 10);
      if (isNaN(ontoTaskId)) {
        jsonOutput.error = `Invalid --onto-task task ID '${options.ontoTask}' - must be a number`;
        await exitWithError(jsonOutput, { telemetry });
        return;
      }

      ontoTask = project.getTask(ontoTaskId);
      if (!ontoTask) {
        jsonOutput.error = `Task ${ontoTaskId} not found`;
        await exitWithError(jsonOutput, { telemetry });
        return;
      }

      ontoBranch = ontoTask.branchName;
    } else if (options.onto) {
      // --onto <branch>: rebase onto a specific branch
      if (!git.branchExists(options.onto)) {
        jsonOutput.error = `Branch '${options.onto}' does not exist`;
        await exitWithError(jsonOutput, { telemetry });
        return;
      }
      ontoBranch = options.onto;
    } else {
      // Default: rebase onto current branch
      ontoBranch = git.getCurrentBranch();
    }

    jsonOutput.currentBranch = git.getCurrentBranch();
    jsonOutput.ontoBranch = ontoBranch;

    if (!isJsonMode()) {
      showTitle('Rebase Task');
      showProperties({
        ID: colors.cyan(task.id.toString()),
        Title: task.title,
        Worktree: task.worktreePath,
        Branch: task.branchName,
        'Onto Branch': ontoBranch,
        Status: task.status,
      });
    }

    if (task.isPushed()) {
      if (!isJsonMode()) {
        console.log(
          colors.yellow(
            '\n⚠ This task has already been pushed. Rebasing will rewrite history and require a force push.'
          )
        );
      }

      if (!options.force && !options.json) {
        try {
          const { confirm } = await prompt<{ confirm: boolean }>({
            type: 'confirm',
            name: 'confirm',
            message:
              'Do you want to continue? This will require a force push afterwards.',
            initial: false,
          });

          if (!confirm) {
            jsonOutput.success = true;
            await exitWithWarn('Task rebase cancelled', jsonOutput, {
              telemetry,
            });
            return;
          }
        } catch (err) {
          jsonOutput.success = true;
          await exitWithWarn('Task rebase cancelled', jsonOutput, {
            telemetry,
          });
          return;
        }
      }
    }

    if (task.isMerged()) {
      jsonOutput.error = 'The task is already merged';
      await exitWithError(jsonOutput, { telemetry });
      return;
    }

    if (!task.isCompleted()) {
      jsonOutput.error = 'The task is not completed yet';
      await exitWithError(jsonOutput, {
        tips: [
          'Use ' +
            colors.cyan(`rover inspect ${numericTaskId}`) +
            ' to check its status',
          'Use ' +
            colors.cyan(`rover logs ${numericTaskId}`) +
            ' to check the logs',
        ],
        telemetry,
      });
      return;
    }

    // Check if worktree exists
    if (!task.worktreePath || !existsSync(task.worktreePath)) {
      jsonOutput.error = 'No worktree found for this task';
      await exitWithError(jsonOutput, { telemetry });
      return;
    }

    // Check for uncommitted changes in main repo
    if (git.hasUncommittedChanges()) {
      jsonOutput.error = `Current branch (${git.getCurrentBranch()}) has uncommitted changes`;
      await exitWithError(jsonOutput, {
        tips: ['Please commit or stash your changes before rebasing'],
        telemetry,
      });
      return;
    }

    // Check if worktree has uncommitted changes
    const hasWorktreeChanges = git.hasUncommittedChanges({
      worktreePath: task.worktreePath,
    });

    if (hasWorktreeChanges && !options.commit) {
      jsonOutput.error = 'Task worktree has uncommitted changes';
      await exitWithError(jsonOutput, {
        tips: [
          `Use ${colors.cyan(`rover rebase ${numericTaskId} --commit`)} to commit changes before rebasing`,
        ],
        telemetry,
      });
      return;
    }

    // Check if the onto-task worktree has uncommitted changes
    let hasOntoTaskWorktreeChanges = false;
    if (ontoTask?.worktreePath && existsSync(ontoTask.worktreePath)) {
      hasOntoTaskWorktreeChanges = git.hasUncommittedChanges({
        worktreePath: ontoTask.worktreePath,
      });

      if (hasOntoTaskWorktreeChanges && !options.commit) {
        jsonOutput.error = `Target task ${ontoTask.id} worktree has uncommitted changes`;
        await exitWithError(jsonOutput, {
          tips: [
            `Use ${colors.cyan(`rover rebase ${numericTaskId} --onto-task ${ontoTask.id} --commit`)} to commit changes in both tasks before rebasing`,
          ],
          telemetry,
        });
        return;
      }
    }

    if (!isJsonMode()) {
      // Show what will happen
      console.log('');
      const rebaseSteps = [];
      if (hasOntoTaskWorktreeChanges) {
        rebaseSteps.push(
          colors.cyan(
            `Commit uncommitted changes in task ${ontoTask!.id} worktree`
          )
        );
      }
      if (hasWorktreeChanges) {
        rebaseSteps.push(
          colors.cyan('Commit uncommitted changes in the task worktree')
        );
      }
      rebaseSteps.push(
        colors.cyan(`Rebase the task branch onto ${ontoBranch}`)
      );
      showList(rebaseSteps, {
        title: colors.cyan('The rebase process will'),
      });
    }

    // Confirm rebase unless force flag is used (skip in JSON mode)
    if (!options.force && !options.json) {
      try {
        const { confirm } = await prompt<{ confirm: boolean }>({
          type: 'confirm',
          name: 'confirm',
          message: 'Do you want to rebase this task?',
          initial: false,
        });

        if (!confirm) {
          jsonOutput.success = true; // User cancelled, not an error
          await exitWithWarn('Task rebase cancelled', jsonOutput, {
            telemetry,
          });
          return;
        }
      } catch (err) {
        jsonOutput.success = true; // User cancelled, not an error
        await exitWithWarn('Task rebase cancelled', jsonOutput, {
          telemetry,
        });
        return;
      }
    }

    if (!isJsonMode()) {
      console.log(''); // breakline
    }

    const spinner = !options.json
      ? yoctoSpinner({ text: 'Preparing rebase...' }).start()
      : null;

    try {
      // Commit uncommitted onto-task worktree changes before rebasing
      if (hasOntoTaskWorktreeChanges && ontoTask) {
        if (spinner)
          spinner.text = `Committing task ${ontoTask.id} worktree changes...`;

        try {
          git.addAndCommit(ontoTask.title, {
            worktreePath: ontoTask.worktreePath,
          });
        } catch (error) {
          spinner?.error(
            `Failed to commit task ${ontoTask.id} worktree changes`
          );
          jsonOutput.error = `Failed to commit uncommitted changes in task ${ontoTask.id} worktree`;
          await exitWithError(jsonOutput, { telemetry });
          return;
        }
      }

      // Commit uncommitted worktree changes before rebasing
      if (hasWorktreeChanges) {
        if (spinner) spinner.text = 'Committing worktree changes...';

        try {
          git.addAndCommit(task.title, {
            worktreePath: task.worktreePath,
          });
        } catch (error) {
          spinner?.error('Failed to commit worktree changes');
          jsonOutput.error =
            'Failed to commit uncommitted changes in the task worktree';
          await exitWithError(jsonOutput, { telemetry });
          return;
        }
      }

      if (spinner) spinner.text = `Rebasing task branch onto ${ontoBranch}...`;

      telemetry?.eventRebaseTask();

      const rebaseSuccessful = git.rebaseBranch(ontoBranch, {
        worktreePath: task.worktreePath,
      });

      if (rebaseSuccessful) {
        spinner?.success('Task rebased successfully');

        // Update baseCommit and sourceBranch to reflect the new base
        const newBaseCommit = git.getCommitHash(ontoBranch);
        if (newBaseCommit) {
          task.setBaseCommit(newBaseCommit);
        }
        task.setSourceBranch(ontoBranch);

        // Execute onRebase hooks if configured
        if (projectConfig?.hooks?.onRebase?.length) {
          executeHooks(
            projectConfig.hooks.onRebase,
            {
              taskId: numericTaskId,
              taskBranch: task.branchName,
              taskTitle: task.title,
              projectPath: project.path,
            },
            'onRebase'
          );
        }

        jsonOutput.rebased = true;
        jsonOutput.success = true;
        await exitWithSuccess(
          `Task branch has been successfully rebased onto ${ontoBranch}`,
          jsonOutput,
          {
            tips: [
              'Run ' +
                colors.cyan(`rover diff ${numericTaskId}`) +
                ' to review the changes.',
              'Run ' +
                colors.cyan(`rover merge ${numericTaskId}`) +
                ' to merge the task when ready.',
            ],
            telemetry,
          }
        );
        return;
      } else {
        // Rebase had conflicts
        const rebaseConflicts = git.getMergeConflicts({
          worktreePath: task.worktreePath,
        });

        if (rebaseConflicts.length > 0) {
          if (spinner) spinner.error('Rebase conflicts detected');

          if (!isJsonMode()) {
            console.log(
              colors.yellow(
                `\n⚠ Rebase conflicts detected in ${rebaseConflicts.length} file(s):`
              )
            );
            showList(rebaseConflicts);
          }

          // Attempt to fix them with an AI
          if (!isJsonMode()) {
            console.log(
              colors.cyan('\nAttempting to resolve conflicts with AI...')
            );
          }

          const resolution = await resolveRebaseConflicts(
            git,
            rebaseConflicts,
            aiAgent,
            task.worktreePath,
            ontoBranch
          );

          if (resolution.success) {
            jsonOutput.conflictsResolved = true;

            if (!isJsonMode()) {
              console.log(
                colors.green('\n✓ AI resolved all conflicts successfully.')
              );

              // Show the staged diff so the user can review the AI's resolutions
              const diffResult = git.diff({
                cached: true,
                worktreePath: task.worktreePath,
              });
              if (diffResult.stdout) {
                console.log(
                  colors.yellow('\nChanges applied by AI to resolve conflicts:')
                );
                showDiff(diffResult.stdout.toString());
              }

              console.log(
                colors.gray(
                  `\nYou can also inspect the resolved files in: ${task.worktreePath}`
                )
              );

              let applyChanges = false;

              // Ask user to review and confirm
              try {
                const { confirmResolution } = await prompt<{
                  confirmResolution: boolean;
                }>({
                  type: 'confirm',
                  name: 'confirmResolution',
                  message: 'Do you want to continue with the rebase?',
                  initial: false,
                });
                applyChanges = confirmResolution;
              } catch (error) {
                // Ignore the error as it's a regular CTRL+C
              }

              if (!applyChanges) {
                git.abortRebase({ worktreePath: task.worktreePath });
                await exitWithWarn(
                  'User rejected AI resolution. Rebase aborted',
                  jsonOutput,
                  { telemetry }
                );
                return;
              }
            }

            // Continue the rebase with the resolved conflicts
            try {
              git.continueRebase({ worktreePath: task.worktreePath });

              // Update baseCommit and sourceBranch to reflect the new base
              const newBaseCommit = git.getCommitHash(ontoBranch);
              if (newBaseCommit) {
                task.setBaseCommit(newBaseCommit);
              }
              task.setSourceBranch(ontoBranch);

              // Execute onRebase hooks if configured
              if (projectConfig?.hooks?.onRebase?.length) {
                executeHooks(
                  projectConfig.hooks.onRebase,
                  {
                    taskId: numericTaskId,
                    taskBranch: task.branchName,
                    taskTitle: task.title,
                    projectPath: project.path,
                  },
                  'onRebase'
                );
              }

              jsonOutput.rebased = true;
              jsonOutput.success = true;

              if (!isJsonMode()) {
                console.log(
                  colors.green(
                    '\n✓ Rebase conflicts resolved and rebase completed'
                  )
                );
              }

              await exitWithSuccess(
                `Task branch has been successfully rebased onto ${ontoBranch}`,
                jsonOutput,
                {
                  tips: [
                    'Run ' +
                      colors.cyan(`rover diff ${numericTaskId}`) +
                      ' to review the changes.',
                    'Run ' +
                      colors.cyan(`rover merge ${numericTaskId}`) +
                      ' to merge the task when ready.',
                  ],
                  telemetry,
                }
              );
              return;
            } catch (commitError) {
              // Cleanup
              git.abortRebase({ worktreePath: task.worktreePath });

              jsonOutput.error = `Error completing rebase after conflict resolution: ${commitError}`;
              await exitWithError(jsonOutput, { telemetry });
              return;
            }
          } else {
            jsonOutput.error =
              resolution.failureReason ||
              'AI failed to resolve rebase conflicts';
            git.abortRebase({ worktreePath: task.worktreePath });

            if (!isJsonMode()) {
              console.log(
                colors.yellow('\n⚠ Rebase aborted due to conflicts.')
              );
              showList(
                [
                  colors.gray(`Enter the worktree: cd ${task.worktreePath}`),
                  colors.gray('Fix conflicts in the listed files'),
                  colors.gray('Run: git add <resolved-files>'),
                  colors.gray('Run: git rebase --continue'),
                ],
                { title: colors.gray('To resolve manually:') }
              );
            }
            await exitWithError(jsonOutput, { telemetry });
            return;
          }
        } else {
          // Other rebase error, not conflicts
          if (spinner) spinner.error('Rebase failed');
          jsonOutput.error = 'Rebase failed';
          await exitWithError(jsonOutput, { telemetry });
          return;
        }
      }
    } catch (error: any) {
      if (spinner) spinner.error('Rebase failed');
      jsonOutput.error = `Error during rebase: ${error.message}`;
      await exitWithError(jsonOutput, { telemetry });
      return;
    }
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      jsonOutput.error = error.message;
      await exitWithError(jsonOutput, { telemetry });
    } else {
      jsonOutput.error = `Error rebasing task: ${error}`;
      await exitWithError(jsonOutput, { telemetry });
    }
  } finally {
    await telemetry?.shutdown();
  }
};

export default {
  name: 'rebase',
  description: 'Rebase the task branch onto the current branch',
  requireProject: true,
  action: rebaseCommand,
} satisfies CommandDefinition;
