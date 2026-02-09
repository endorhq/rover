import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import yoctoSpinner from 'yocto-spinner';
import { getAIAgentTool, type AIAgentTool } from '../lib/agents/index.js';
import {
  AI_AGENT,
  Git,
  ProjectConfigManager,
  UserSettingsManager,
} from 'rover-core';
import { TaskNotFoundError } from 'rover-schemas';
import { executeHooks } from '../lib/hooks.js';
import { getTelemetry } from '../lib/telemetry.js';
import { showRoverChat, showTips } from '../utils/display.js';
import { exitWithError, exitWithSuccess, exitWithWarn } from '../utils/exit.js';
import type { TaskMergeOutput } from '../output-types.js';
import {
  isJsonMode,
  setJsonMode,
  requireProjectContext,
} from '../lib/context.js';
import type { CommandDefinition } from '../types.js';

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
      .sort((a, b) => a - b); // Sort ascending

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
  aiAgent: AIAgentTool,
  options: { json?: boolean } = {}
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
 * AI-powered merge conflict resolver
 */
const resolveMergeConflicts = async (
  git: Git,
  conflictedFiles: string[],
  aiAgent: AIAgentTool,
  json: boolean
): Promise<boolean> => {
  let spinner;

  if (!isJsonMode()) {
    spinner = yoctoSpinner({ text: 'Analyzing merge conflicts...' }).start();
  }

  try {
    // Process each conflicted file
    for (const filePath of conflictedFiles) {
      if (spinner) {
        spinner.text = `Resolving conflicts in ${filePath}...`;
      }

      if (!existsSync(filePath)) {
        spinner?.error(`File ${filePath} not found, skipping...`);
        continue;
      }

      // Read the conflicted file
      const conflictedContent = readFileSync(filePath, 'utf8');

      // Get git diff context for better understanding
      const diffContext = git
        .getRecentCommits({
          branch: git.getCurrentBranch(),
        })
        .join('\n');

      try {
        const resolvedContent = await aiAgent.resolveMergeConflicts(
          filePath,
          diffContext,
          conflictedContent
        );

        if (!resolvedContent) {
          spinner?.error(`Failed to resolve conflicts in ${filePath}`);
          return false;
        }

        // Write the resolved content back to the file
        writeFileSync(filePath, resolvedContent);

        // Stage the resolved file
        if (!git.add(filePath)) {
          spinner?.error(`Error adding ${filePath} to the git commit`);
          return false;
        }
      } catch (error) {
        spinner?.error(`Error resolving ${filePath}: ${error}`);
        return false;
      }
    }

    spinner?.success('All conflicts resolved by AI');
    return true;
  } catch (error) {
    spinner?.error('Failed to resolve merge conflicts');
    return false;
  }
};

interface MergeOptions {
  force?: boolean;
  json?: boolean;
}

/**
 * Merge a completed task's changes into the current branch.
 *
 * Handles the full merge workflow: commits any uncommitted worktree changes
 * with an AI-generated commit message, merges the task branch into the current
 * branch, and handles merge conflicts using AI-powered resolution. Triggers
 * onMerge hooks after successful merges.
 *
 * @param taskId - The numeric task ID to merge
 * @param options - Command options
 * @param options.force - Skip confirmation prompt
 * @param options.json - Output results in JSON format
 */
const mergeCommand = async (taskId: string, options: MergeOptions = {}) => {
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

  const telemetry = getTelemetry();
  const jsonOutput: TaskMergeOutput = {
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
    jsonOutput.error = 'No worktree found for this task';
    await exitWithError(jsonOutput, { telemetry });
    return;
  }

  if (!isJsonMode()) {
    showRoverChat([
      'We are ready to go',
      "Let's merge the task changes and ship it!",
    ]);
  }

  jsonOutput.taskId = numericTaskId;

  // Load AI agent selection from user settings
  let selectedAiAgent = 'claude'; // default
  let projectConfig;

  // Load config
  try {
    projectConfig = ProjectConfigManager.load(project.path);
  } catch (err) {
    if (!isJsonMode()) {
      console.log(colors.yellow('⚠ Could not load project settings'));
    }
  }

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

    if (!isJsonMode()) {
      console.log(colors.bold('Merge Task'));
      console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
      console.log(colors.gray('├── Title: ') + task.title);
      console.log(colors.gray('├── Worktree: ') + task.worktreePath);
      console.log(colors.gray('├── Branch: ') + task.branchName);
      console.log(colors.gray('└── Status: ') + task.status);
    }

    if (task.isPushed()) {
      jsonOutput.error = 'The task is already merged and pushed';
      await exitWithError(jsonOutput, { telemetry });
      return;
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

    // Get current branch name
    jsonOutput.currentBranch = git.getCurrentBranch();

    // Check for uncommitted changes in main repo
    if (git.hasUncommittedChanges()) {
      jsonOutput.error = `Current branch (${git.getCurrentBranch()}) has uncommitted changes`;
      await exitWithError(jsonOutput, {
        tips: ['Please commit or stash your changes before merging'],
        telemetry,
      });
      return;
    }

    // Check if worktree has changes to commit or if there are unmerged commits
    const hasWorktreeChanges = git.hasUncommittedChanges({
      worktreePath: task.worktreePath,
    });
    const taskBranch = task.branchName;
    const hasUnmerged = git.hasUnmergedCommits(taskBranch);

    jsonOutput.hasWorktreeChanges = hasWorktreeChanges;
    jsonOutput.hasUnmergedCommits = hasUnmerged;

    if (!hasWorktreeChanges && !hasUnmerged) {
      jsonOutput.success = true;
      await exitWithSuccess('No changes to merge', jsonOutput, {
        tips: [
          'The task worktree has no uncommitted changes nor unmerged commits',
        ],
        telemetry,
      });
      return;
    }

    if (!isJsonMode()) {
      // Show what will happen
      console.log('');
      console.log(colors.cyan('The merge process will'));
      if (hasWorktreeChanges) {
        console.log(colors.cyan('├── Commit changes in the task worktree'));
      }
      console.log(
        colors.cyan('├── Merge the task branch into the current branch')
      );
      console.log(colors.cyan('└── Clean up the worktree and branch'));
    }

    // Confirm merge unless force flag is used (skip in JSON mode)
    if (!options.force && !options.json) {
      try {
        const { confirm } = await prompt<{ confirm: boolean }>({
          type: 'confirm',
          name: 'confirm',
          message: 'Do you want to merge this task?',
          initial: false,
        });

        if (!confirm) {
          jsonOutput.success = true; // User cancelled, not an error
          await exitWithWarn('Task merge cancelled', jsonOutput, {
            telemetry,
          });
          return;
        }
      } catch (err) {
        jsonOutput.success = true; // User cancelled, not an error
        await exitWithWarn('Task merge cancelled', jsonOutput, {
          telemetry,
        });
        return;
      }
    }

    if (!isJsonMode()) {
      console.log(''); // breakline
    }

    const spinner = !options.json
      ? yoctoSpinner({ text: 'Preparing merge...' }).start()
      : null;

    try {
      // Get recent commit messages for AI context
      if (spinner) spinner.text = 'Gathering commit context...';
      const recentCommits = git.getRecentCommits();

      let finalCommitMessage = '';

      // Only commit if there are worktree changes
      if (hasWorktreeChanges) {
        // Get iteration summaries
        const summaries = getTaskIterationSummaries(task.iterationsPath());

        // Generate AI commit message
        if (spinner) spinner.text = 'Generating commit message with AI...';
        const aiCommitMessage = await generateCommitMessage(
          task.title,
          task.description,
          recentCommits,
          summaries,
          aiAgent,
          options
        );

        // Fallback commit message if AI fails
        const commitMessage = aiCommitMessage || task.title;

        // Add Co-Authored-By line when attribution is enabled
        if (projectConfig == null || projectConfig?.attribution === true) {
          finalCommitMessage = `${commitMessage}\n\nCo-Authored-By: Rover <noreply@endor.dev>`;
        } else {
          finalCommitMessage = commitMessage;
        }

        jsonOutput.commitMessage = finalCommitMessage.split('\n')[0]; // Store first line for JSON output

        if (spinner) spinner.text = 'Committing changes in worktree...';

        // Switch to worktree and commit changes
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

      if (spinner) spinner.text = 'Merging task branch...';

      // Attempt to merge the task branch
      const taskBranch = task.branchName;
      let mergeSuccessful = false;

      telemetry?.eventMergeTask();

      const merge = git.mergeBranch(taskBranch, `merge: ${task.title}`);

      if (merge) {
        // Update status
        mergeSuccessful = true;
        jsonOutput.merged = true;
        task.markMerged(); // Set status to MERGED

        spinner?.success('Task merged successfully');
      } else {
        // Failed merge! Check if this is a merge conflict
        const mergeConflicts = git.getMergeConflicts();

        if (mergeConflicts.length > 0) {
          if (spinner) spinner.error('Merge conflicts detected');

          if (!isJsonMode()) {
            // Print conflicts
            console.log(
              colors.yellow(
                `\n⚠ Merge conflicts detected in ${mergeConflicts.length} file(s):`
              )
            );
            mergeConflicts.forEach((file, index) => {
              const isLast = index === mergeConflicts.length - 1;
              const connector = isLast ? '└──' : '├──';
              console.log(colors.gray(connector), file);
            });
          }

          // Attempt to fix them with an AI
          if (!isJsonMode()) {
            showRoverChat([
              'I noticed some merge conflicts. I will try to solve them',
            ]);
          }

          const resolutionSuccessful = await resolveMergeConflicts(
            git,
            mergeConflicts,
            aiAgent,
            options.json === true
          );

          if (resolutionSuccessful) {
            jsonOutput.conflictsResolved = true;

            if (!isJsonMode()) {
              showRoverChat([
                'The merge conflicts are fixed. You can check the file content to confirm it.',
              ]);

              let applyChanges = false;

              // Ask user to review and confirm
              try {
                const { confirmResolution } = await prompt<{
                  confirmResolution: boolean;
                }>({
                  type: 'confirm',
                  name: 'confirmResolution',
                  message: 'Do you want to continue with the merge?',
                  initial: false,
                });
                applyChanges = confirmResolution;
              } catch (error) {
                // Ignore the error as it's a regular CTRL+C
              }

              if (!applyChanges) {
                git.abortMerge();
                await exitWithWarn(
                  'User rejected AI resolution. Merge aborted',
                  jsonOutput,
                  { telemetry }
                );
                return;
              }
            }

            // Complete the merge with the resolved conflicts
            try {
              git.continueMerge();

              mergeSuccessful = true;
              jsonOutput.merged = true;
              task.markMerged();

              if (!isJsonMode()) {
                console.log(
                  colors.green(
                    '\n✓ Merge conflicts resolved and merge completed'
                  )
                );
              }
            } catch (commitError) {
              // Cleanup
              git.abortMerge();

              jsonOutput.error = `Error completing merge after conflict resolution: ${commitError}`;
              await exitWithError(jsonOutput, { telemetry });
              return;
            }
          } else {
            jsonOutput.error = 'AI failed to resolve merge conflicts';
            if (!isJsonMode()) {
              console.log(colors.yellow('\n⚠ Merge aborted due to conflicts.'));
              console.log(colors.gray('To resolve manually:'));
              console.log(
                colors.gray('├──'),
                colors.gray('1. Fix conflicts in the listed files')
              );
              console.log(
                colors.gray('├──'),
                colors.gray('2. Run: git add <resolved-files>')
              );
              console.log(
                colors.gray('└──'),
                colors.gray('3. Run: git merge --continue')
              );

              console.log('\nIf you prefer to stop the process:');
              console.log(colors.cyan(`└── 1. Run: git merge --abort`));
            }
            await exitWithError(jsonOutput, { telemetry });
            return;
          }
        } else {
          // Other merge error, not conflicts
          if (spinner) spinner.error('Merge failed');
        }
      }

      if (mergeSuccessful) {
        // Execute onMerge hooks if configured
        if (projectConfig?.hooks?.onMerge?.length) {
          executeHooks(
            projectConfig.hooks.onMerge,
            {
              taskId: numericTaskId,
              taskBranch: taskBranch,
              taskTitle: task.title,
              projectPath: project.path,
            },
            'onMerge'
          );
        }

        jsonOutput.success = true;
        await exitWithSuccess(
          'Task has been successfully merged into your current branch',
          jsonOutput,
          {
            tips: [
              'Run ' +
                colors.cyan(`rover del ${numericTaskId}`) +
                ' to cleanup the workspace, task and git branch.',
            ],
            telemetry,
          }
        );
        return;
      }
    } catch (error: any) {
      if (spinner) spinner.error('Merge failed');
      jsonOutput.error = `Error during merge: ${error.message}`;
      await exitWithError(jsonOutput, { telemetry });
      return;
    }
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      jsonOutput.error = error.message;
      await exitWithError(jsonOutput, { telemetry });
    } else {
      jsonOutput.error = `Error merging task: ${error}`;
      await exitWithError(jsonOutput, { telemetry });
    }
  } finally {
    await telemetry?.shutdown();
  }
};

export default {
  name: 'merge',
  description: 'Merge the task changes into your current branch',
  requireProject: true,
  action: mergeCommand,
} satisfies CommandDefinition;
