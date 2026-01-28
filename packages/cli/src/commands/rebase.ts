import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yoctoSpinner from 'yocto-spinner';
import {
  getAIAgentTool,
  getUserDefaultModel,
  type AIAgentTool,
} from '../lib/agents/index.js';
import {
  AI_AGENT,
  Git,
  ProjectConfigManager,
  UserSettingsManager,
} from 'rover-core';
import { TaskNotFoundError } from 'rover-schemas';
import { getTelemetry } from '../lib/telemetry.js';
import { showRoverChat } from '../utils/display.js';
import { exitWithError, exitWithSuccess, exitWithWarn } from '../utils/exit.js';
import type { CLIJsonOutput } from '../types.js';
import {
  isJsonMode,
  setJsonMode,
  requireProjectContext,
} from '../lib/context.js';
import type { CommandDefinition } from '../types.js';
import { parseAgentString } from '../utils/agent-parser.js';

const { prompt } = enquirer;

/**
 * Get summaries from all iterations of a task
 */
const getTaskIterationSummaries = (iterationsPath: string): string[] => {
  try {
    if (!existsSync(iterationsPath)) {
      return [];
    }

    const iterations = readdirSync(iterationsPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => parseInt(dirent.name, 10))
      .filter(num => !Number.isNaN(num))
      .sort((a, b) => a - b);

    const summaries: string[] = [];

    for (const iteration of iterations) {
      const iterationPath = join(iterationsPath, iteration.toString());
      const summaryPath = join(iterationPath, 'summary.md');

      if (existsSync(summaryPath)) {
        try {
          const summary = readFileSync(summaryPath, 'utf8').trim();
          if (summary) {
            summaries.push(`Iteration ${iteration}: ${summary}`);
          }
        } catch (error) {
          if (!isJsonMode()) {
            console.warn(
              colors.yellow(
                `Warning: Could not read summary for iteration ${iteration}`
              )
            );
          }
        }
      }
    }

    return summaries;
  } catch (error) {
    if (!isJsonMode()) {
      console.warn(
        colors.yellow('Warning: Could not retrieve iteration summaries')
      );
    }
    return [];
  }
};

/**
 * Generate AI-powered commit message
 */
const generateCommitMessage = async (
  taskTitle: string,
  taskDescription: string,
  recentCommits: string[],
  summaries: string[],
  aiAgent: AIAgentTool
): Promise<string | null> => {
  try {
    const commitMessage = await aiAgent.generateCommitMessage(
      taskTitle,
      taskDescription,
      recentCommits,
      summaries
    );

    if (commitMessage == null || commitMessage.length === 0) {
      if (!isJsonMode()) {
        console.warn(
          colors.yellow('Warning: Could not generate AI commit message')
        );
      }
    }

    return commitMessage;
  } catch (error) {
    if (!isJsonMode()) {
      console.warn(
        colors.yellow('Warning: Could not generate AI commit message')
      );
    }
    return null;
  }
};

/**
 * AI-powered rebase conflict resolver
 */
const resolveRebaseConflicts = async (
  git: Git,
  conflictedFiles: string[],
  aiAgent: AIAgentTool,
  worktreePath: string,
  concurrency: number = 4
): Promise<{ success: boolean; failureReason?: string }> => {
  let spinner;

  if (!isJsonMode()) {
    spinner = yoctoSpinner({
      text: `Resolving conflicts in ${conflictedFiles.length} file(s)...`,
    }).start();
  }

  try {
    // Compute diff context once before the loop
    const currentBranchName = git.getCurrentBranch({ worktreePath });
    const diffContext = git
      .getRecentCommits({
        branch: currentBranchName === 'unknown' ? 'HEAD' : currentBranchName,
        worktreePath,
      })
      .join('\n');

    const failures: string[] = [];
    let resolvedCount = 0;
    const executing: Promise<void>[] = [];

    for (const filePath of conflictedFiles) {
      const task = (async () => {
        const fullPath = join(worktreePath, filePath);
        if (!existsSync(fullPath)) {
          failures.push(`File ${filePath} not found`);
          return;
        }

        const conflictedContent = readFileSync(fullPath, 'utf8');

        try {
          const resolvedContent = await aiAgent.resolveMergeConflicts(
            filePath,
            diffContext,
            conflictedContent
          );

          if (!resolvedContent) {
            failures.push(`AI returned empty resolution for ${filePath}`);
            return;
          }

          writeFileSync(fullPath, resolvedContent);

          if (!git.add(filePath, { worktreePath })) {
            failures.push(`Error adding ${filePath} to the git commit`);
            return;
          }

          resolvedCount++;
          if (spinner) {
            spinner.text = `Resolved ${resolvedCount}/${conflictedFiles.length} file(s)...`;
          }
        } catch (error) {
          failures.push(`Error resolving ${filePath}: ${error}`);
        }
      })();

      const wrapped = task.then(() => {
        executing.splice(executing.indexOf(wrapped), 1);
      });
      executing.push(wrapped);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);

    if (failures.length > 0) {
      const reason = failures.join('; ');
      spinner?.error(`Failed to resolve ${failures.length} file(s)`);
      return { success: false, failureReason: reason };
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
  agent?: string;
  concurrency?: string;
  force?: boolean;
  json?: boolean;
}

interface TaskRebaseOutput extends CLIJsonOutput {
  taskId?: number;
  taskTitle?: string;
  branchName?: string;
  currentBranch?: string;
  hasWorktreeChanges?: boolean;
  committed?: boolean;
  commitMessage?: string;
  rebased?: boolean;
  conflictsResolved?: boolean;
}

/**
 * Rebase a task's branch onto the current branch.
 *
 * Handles the full rebase workflow: commits any uncommitted worktree changes
 * with an AI-generated commit message, rebases the task branch onto the current
 * branch, and handles conflicts using AI-powered resolution.
 *
 * @param taskId - The numeric task ID to rebase
 * @param options - Command options
 * @param options.agent - AI agent with optional model (e.g., claude:sonnet)
 * @param options.force - Skip confirmation prompt
 * @param options.json - Output results in JSON format
 */
const rebaseCommand = async (taskId: string, options: RebaseOptions = {}) => {
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

  const telemetry = getTelemetry();
  const jsonOutput: TaskRebaseOutput = {
    success: false,
  };

  const numericTaskId = parseInt(taskId, 10);
  if (isNaN(numericTaskId)) {
    jsonOutput.error = `Invalid task ID '${taskId}' - must be a number`;
    await exitWithError(jsonOutput, { telemetry });
    return;
  }

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

  if (!isJsonMode()) {
    showRoverChat(["Let's rebase the task branch onto your current branch"]);
  }

  jsonOutput.taskId = numericTaskId;

  // Load AI agent selection
  let selectedAiAgent = 'claude';
  let selectedModel: string | undefined;
  let projectConfig;

  try {
    projectConfig = ProjectConfigManager.load(project.path);
  } catch (err) {
    if (!isJsonMode()) {
      console.log(colors.yellow('⚠ Could not load project settings'));
    }
  }

  if (options.agent) {
    const parsed = parseAgentString(options.agent);
    selectedAiAgent = parsed.agent;
    selectedModel = parsed.model;
  } else {
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

    selectedModel = getUserDefaultModel(selectedAiAgent as AI_AGENT);
  }

  const aiAgent = getAIAgentTool(selectedAiAgent, selectedModel);

  try {
    const task = project.getTask(numericTaskId);
    if (!task) {
      throw new TaskNotFoundError(numericTaskId);
    }

    jsonOutput.taskTitle = task.title;
    jsonOutput.branchName = task.branchName;

    if (!isJsonMode()) {
      console.log(colors.bold('Rebase Task'));
      console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
      console.log(colors.gray('├── Title: ') + task.title);
      console.log(colors.gray('├── Worktree: ') + task.worktreePath);
      console.log(colors.gray('├── Branch: ') + task.branchName);
      console.log(colors.gray('└── Status: ') + task.status);
    }

    // Check if worktree exists
    if (!task.worktreePath || !existsSync(task.worktreePath)) {
      jsonOutput.error = 'No worktree found for this task';
      await exitWithError(jsonOutput, { telemetry });
      return;
    }

    // Get current branch name
    const currentBranch = git.getCurrentBranch();
    jsonOutput.currentBranch = currentBranch;

    // Check for uncommitted changes in main repo
    if (git.hasUncommittedChanges()) {
      jsonOutput.error = `Current branch (${currentBranch}) has uncommitted changes`;
      await exitWithError(jsonOutput, {
        tips: ['Please commit or stash your changes before rebasing'],
        telemetry,
      });
      return;
    }

    // Check if worktree has changes to commit
    const hasWorktreeChanges = git.hasUncommittedChanges({
      worktreePath: task.worktreePath,
    });

    jsonOutput.hasWorktreeChanges = hasWorktreeChanges;

    if (!isJsonMode()) {
      console.log('');
      console.log(colors.cyan('The rebase process will'));
      if (hasWorktreeChanges) {
        console.log(colors.cyan('├── Commit changes in the task worktree'));
      }
      console.log(
        colors.cyan(`├── Rebase the task branch onto ${currentBranch}`)
      );
      console.log(colors.cyan('└── Resolve any conflicts if needed'));
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

    if (!isJsonMode()) {
      console.log('');
    }

    const spinner = !options.json
      ? yoctoSpinner({ text: 'Preparing rebase...' }).start()
      : null;

    try {
      // Commit worktree changes if needed
      if (hasWorktreeChanges) {
        const recentCommits = git.getRecentCommits({
          branch: task.branchName,
          worktreePath: task.worktreePath,
        });
        const summaries = getTaskIterationSummaries(task.iterationsPath());

        if (spinner) spinner.text = 'Generating commit message with AI...';
        const aiCommitMessage = await generateCommitMessage(
          task.title,
          task.description,
          recentCommits,
          summaries,
          aiAgent
        );

        const commitMessage = aiCommitMessage || task.title;

        let finalCommitMessage: string;
        if (projectConfig == null || projectConfig?.attribution === true) {
          finalCommitMessage = `${commitMessage}\n\nCo-Authored-By: Rover <noreply@endor.dev>`;
        } else {
          finalCommitMessage = commitMessage;
        }

        jsonOutput.commitMessage = finalCommitMessage.split('\n')[0];

        if (spinner) spinner.text = 'Committing changes in worktree...';

        try {
          git.addAndCommit(finalCommitMessage, {
            worktreePath: task.worktreePath,
          });
          jsonOutput.committed = true;
        } catch (error) {
          jsonOutput.committed = false;
          spinner?.error('Failed to commit changes');
          jsonOutput.error =
            'Failed to add and commit changes in the workspace';
          await exitWithError(jsonOutput, { telemetry });
          return;
        }
      }

      if (spinner) spinner.text = 'Rebasing task branch...';

      // Rebase the task branch onto the current branch
      const rebaseResult = git.rebaseBranch(currentBranch, {
        worktreePath: task.worktreePath,
      });

      if (rebaseResult.success) {
        jsonOutput.rebased = true;
        spinner?.success('Task branch rebased successfully');
      } else {
        // Check for conflicts
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
            rebaseConflicts.forEach((file, index) => {
              const isLast = index === rebaseConflicts.length - 1;
              const connector = isLast ? '└──' : '├──';
              console.log(colors.gray(connector), file);
            });
          }

          if (!isJsonMode()) {
            showRoverChat([
              'I noticed some rebase conflicts. I will try to solve them',
            ]);
          }

          const concurrency = parseInt(options.concurrency || '4', 10);
          const resolution = await resolveRebaseConflicts(
            git,
            rebaseConflicts,
            aiAgent,
            task.worktreePath,
            concurrency
          );

          if (resolution.success) {
            jsonOutput.conflictsResolved = true;

            if (!isJsonMode()) {
              showRoverChat([
                'The rebase conflicts are fixed. You can check the file content to confirm it.',
              ]);

              let applyChanges = false;

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

            // Continue the rebase with resolved conflicts
            try {
              git.continueRebase({ worktreePath: task.worktreePath });

              jsonOutput.rebased = true;

              if (!isJsonMode()) {
                console.log(
                  colors.green(
                    '\n✓ Rebase conflicts resolved and rebase completed'
                  )
                );
              }
            } catch (continueError) {
              git.abortRebase({ worktreePath: task.worktreePath });

              jsonOutput.error = `Error completing rebase after conflict resolution: ${continueError}`;
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
              console.log(colors.gray('To resolve manually:'));
              console.log(
                colors.gray('├──'),
                colors.gray(
                  `1. cd ${task.worktreePath} && git rebase ${currentBranch}`
                )
              );
              console.log(
                colors.gray('├──'),
                colors.gray('2. Fix conflicts in the listed files')
              );
              console.log(
                colors.gray('├──'),
                colors.gray('3. Run: git add <resolved-files>')
              );
              console.log(
                colors.gray('└──'),
                colors.gray('4. Run: git rebase --continue')
              );
            }
            await exitWithError(jsonOutput, { telemetry });
            return;
          }
        } else {
          // Other rebase error, not conflicts
          if (spinner) spinner.error('Rebase failed');
          jsonOutput.error =
            rebaseResult.error || 'Rebase failed with an unknown error';
          await exitWithError(jsonOutput, { telemetry });
          return;
        }
      }

      if (jsonOutput.rebased) {
        jsonOutput.success = true;
        await exitWithSuccess(
          'Task branch has been successfully rebased onto your current branch',
          jsonOutput,
          {
            tips: [
              'The task branch is now up to date with ' +
                colors.cyan(currentBranch),
            ],
            telemetry,
          }
        );
        return;
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
  description: 'Rebase the task branch onto your current branch',
  requireProject: true,
  action: rebaseCommand,
} satisfies CommandDefinition;
