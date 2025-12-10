import colors from 'ansi-colors';
import enquirer from 'enquirer';
import yoctoSpinner from 'yocto-spinner';
import { existsSync } from 'node:fs';
import { TaskDescriptionManager, TaskNotFoundError } from 'rover-schemas';
import { getTelemetry } from '../lib/telemetry.js';
import { CLIJsonOutput } from '../types.js';
import { exitWithError, exitWithSuccess, exitWithWarn } from '../utils/exit.js';
import { isJsonMode, setJsonMode } from '../lib/global-state.js';
import { showRoverChat, TIP_TITLES } from '../utils/display.js';
import { statusColor } from '../utils/task-status.js';
import { Git } from 'rover-core';
import { ProjectConfigManager } from 'rover-schemas';

const { prompt } = enquirer;

interface PushOptions {
  message?: string;
  pr?: boolean;
  json?: boolean;
}

/**
 * Get GitHub repo info from remote URL
 */
const getGitHubRepoInfo = (
  remoteUrl: string
): { owner: string; repo: string } | null => {
  // Handle various GitHub URL formats
  const patterns = [
    /github\.com[:/]([^/]+)\/([^/.]+)(\.git)?$/,
    /^git@github\.com:([^/]+)\/([^/.]+)(\.git)?$/,
    /^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/,
  ];

  for (const pattern of patterns) {
    const match = remoteUrl.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  }

  return null;
};

interface PushResult extends CLIJsonOutput {
  taskId: number;
  taskTitle: string;
  branchName: string;
  hasChanges: boolean;
  committed: boolean;
  commitMessage?: string;
  pushed: boolean;
}

/**
 * Push command implementation
 */
export const pushCommand = async (taskId: string, options: PushOptions) => {
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

  const telemetry = getTelemetry();
  const json = options.json === true;
  const git = new Git();
  const result: PushResult = {
    success: false,
    taskId: 0,
    taskTitle: '',
    branchName: '',
    hasChanges: false,
    committed: false,
    pushed: false,
  };

  // Convert string taskId to number
  const numericTaskId = parseInt(taskId, 10);
  if (isNaN(numericTaskId)) {
    result.error = `Invalid task ID '${taskId}' - must be a number`;
    await exitWithError(result, { telemetry });
    return;
  }

  // Store the task ID!
  result.taskId = numericTaskId;

  let projectConfig;

  // Load config
  try {
    projectConfig = ProjectConfigManager.load();
  } catch (err) {
    if (!isJsonMode()) {
      console.log(colors.yellow('⚠ Could not load project settings'));
    }
  }

  try {
    // Load task using TaskDescription
    const task = TaskDescriptionManager.load(numericTaskId);

    result.taskTitle = task.title;
    result.branchName = task.branchName;

    if (!task.worktreePath || !existsSync(task.worktreePath)) {
      result.error = 'Task workspace not found';
      await exitWithError(result, { telemetry });
      return;
    }

    if (!isJsonMode()) {
      showRoverChat(["We are good to go. Let's push the changes."]);

      const colorFunc = statusColor(task.status);

      console.log(colors.bold('Push task changes'));
      console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
      console.log(colors.gray('├── Title: ') + task.title);
      console.log(colors.gray('├── Branch: ') + task.branchName);
      console.log(colors.gray('└── Status: ') + colorFunc(task.status) + '\n');
    }

    // Check for changes
    const fileChanges = git.uncommittedChanges({
      worktreePath: task.worktreePath,
    });
    const hasChanges = fileChanges.length > 0;
    result.hasChanges = hasChanges;

    if (!hasChanges) {
      // Check if there are unpushed commits
      try {
        const unpushedCommits = git.hasUnmergedCommits(task.branchName, {
          targetBranch: `origin/${task.branchName}`,
          worktreePath: task.worktreePath,
        });

        if (!unpushedCommits) {
          result.success = true;
          await exitWithWarn('No changes to push', result, { telemetry });
          return;
        }
      } catch {
        // Remote branch doesn't exist yet, continue with push
      }
    }

    // If there are changes, commit them
    if (hasChanges) {
      // Get commit message
      let commitMessage = options.message;
      if (!commitMessage) {
        const defaultMessage = `Task ${numericTaskId}: ${task.title}`;
        if (isJsonMode()) {
          commitMessage = defaultMessage;
        } else {
          try {
            const { message } = await prompt<{ message: string }>({
              type: 'input',
              name: 'message',
              message: 'Commit message:',
              initial: defaultMessage,
            });
            commitMessage = message;
          } catch (err) {
            console.log(
              colors.yellow(
                '\n⚠ Commit message skipped. Using default message.'
              )
            );
            commitMessage = defaultMessage;
          }
        }
      }

      if (projectConfig == null || projectConfig?.attribution === true) {
        commitMessage = `${commitMessage}\n\nCo-Authored-By: Rover <noreply@endor.dev>`;
      }

      result.commitMessage = commitMessage;

      // Stage and commit changes
      const commitSpinner = !options.json
        ? yoctoSpinner({ text: 'Committing changes...' }).start()
        : null;
      try {
        git.addAndCommit(commitMessage, {
          worktreePath: task.worktreePath,
        });
        result.committed = true;
        commitSpinner?.success('Changes committed');
      } catch (error: any) {
        result.error = `Failed to commit changes: ${error.message}`;
        commitSpinner?.error('Failed to commit changes');
        await exitWithError(result, { telemetry });
        return;
      }
    }

    // Push to remote
    telemetry?.eventPushBranch();

    const pushSpinner = !options.json
      ? yoctoSpinner({
          text: `Pushing branch ${task.branchName} to remote...`,
        }).start()
      : null;
    try {
      git.push(task.branchName, {
        worktreePath: task.worktreePath,
      });
      result.pushed = true;
      task.markPushed(); // Set status to PUSHED
      if (pushSpinner) {
        pushSpinner.success(`Branch pushed successfully`);
      }
    } catch (error: any) {
      // Check if it's because the remote branch doesn't exist
      if (error.message.includes('has no upstream branch')) {
        if (pushSpinner) {
          pushSpinner.text =
            'Branch does not exist in remote. Setting upstream branch';
        }

        try {
          git.push(task.branchName, {
            setUpstream: true,
            worktreePath: task.worktreePath,
          });
          result.pushed = true;
          pushSpinner?.success('Branch pushed successfully');
          task.markPushed(); // Set status to PUSHED
          if (!isJsonMode()) {
            console.log(colors.green(`✓ Branch pushed successfully`));
          }
        } catch (retryError: any) {
          pushSpinner?.error('Failed to push branch');
          result.error = `Failed to push branch: ${retryError.message}`;
          await exitWithError(result, { telemetry });
          return;
        }
      } else {
        pushSpinner?.error('Failed to push branch');
        result.error = `Failed to push branch: ${error.message}`;
        await exitWithError(result, { telemetry });
        return;
      }
    }

    // TODO: Skip PR feature for now until we improve the process
    // Check if this is a GitHub repo
    // if (options.pr === true) {
    //     try {
    //         const remoteUrl = git.remoteUrl();
    //         const repoInfo = getGitHubRepoInfo(remoteUrl);

    //         if (repoInfo) {
    //             const ghCli = await checkGitHubCLI();
    //             // Check if gh CLI is available
    //             if (!ghCli) {
    //                 result.pullRequest = {
    //                     created: false
    //                 };
    //                 if (!isJsonMode()) {
    //                     console.log(colors.yellow('\n⚠ GitHub CLI (gh) not found'));
    //                     console.log(colors.gray('  Install it from: https://cli.github.com'));
    //                     console.log(colors.gray('  Then you can create a PR with: ') +
    //                         colors.cyan(`gh pr create --title "${task.title}" --body "..."`));
    //                 }
    //             } else {
    //                 const prSpinner = !options.json ? yoctoSpinner({ text: 'Creating pull request...' }).start() : null;
    //                 try {
    //                     // Create PR with task details
    //                     // TODO: Improve it by creating a custom body based on the task changes.
    //                     const prBody = `## Task ${numericTaskId}\n\n${task.description}\n\n---\n*Created by Rover CLI*`;
    //                     const { stdout } = spawnSync(
    //                         'gh', ['pr', 'create', '--title', task.title, '--body', prBody, '--head', task.branchName]);

    //                     result.pullRequest = {
    //                         created: true,
    //                         url: stdout.toString().trim().split('\n').pop()
    //                     };

    //                     prSpinner?.success('Pull request created');

    //                     if (!isJsonMode()) {
    //                         console.log(colors.green('\n✓ Pull Request created: ') + colors.cyan(result.pullRequest.url || 'Not available'));
    //                     }
    //                 } catch (error: any) {
    //                     prSpinner?.error('Failed to create pull request');

    //                     // Check if PR already exists
    //                     if (error.message.includes('already exists')) {
    //                         result.pullRequest = {
    //                             created: false,
    //                             exists: true
    //                         };

    //                         // Try to get existing PR URL
    //                         try {
    //                             const { stdout } = spawnSync('gh', ['pr', 'view', task.branchName, '--json', 'url', '-q', '.url']);
    //                             result.pullRequest.url = stdout.toString().trim();
    //                         } catch {
    //                             // Couldn't get PR URL
    //                         }

    //                         if (!isJsonMode()) {
    //                             console.log(colors.yellow('⚠ A pull request already exists for this branch'));
    //                             if (result.pullRequest.url) {
    //                                 console.log(colors.gray('  Existing PR: ') + colors.cyan(result.pullRequest.url));
    //                             }
    //                         }
    //                     } else {
    //                         result.pullRequest = {
    //                             created: false
    //                         };
    //                         if (!isJsonMode()) {
    //                             console.error(colors.red('Error:'), error.message);
    //                             console.log(colors.gray('\n  You can manually create a PR at:'));
    //                             console.log(colors.cyan(`  https://github.com/${repoInfo.owner}/${repoInfo.repo}/pull/new/${task.branchName}`));
    //                         }
    //                     }
    //                 }
    //             }
    //         }
    //     } catch (error) {
    //         // Not a GitHub repo or couldn't determine, skip PR creation
    //     }
    // }

    let repoInfo;

    try {
      const remoteUrl = git.remoteUrl();
      repoInfo = getGitHubRepoInfo(remoteUrl);
    } catch (_err) {
      // Ignore the error
    }

    result.success = true;

    const tips = [];
    if (repoInfo != null) {
      tips.push(
        'You can open a new PR on ' +
          colors.cyan(
            `https://github.com/${repoInfo.owner}/${repoInfo.repo}/pull/new/${task.branchName}`
          )
      );
    }

    await exitWithSuccess('Push completed successfully!', result, {
      tips,
      tipsConfig: {
        title: TIP_TITLES.NEXT_STEPS,
      },
      telemetry,
    });
  } catch (error: any) {
    if (error instanceof TaskNotFoundError) {
      result.error = `The task with ID ${numericTaskId} was not found`;
      await exitWithError(result, { telemetry });
    } else {
      result.error = `There was an error deleting the task: ${error}`;
      await exitWithError(result, { telemetry });
    }
  } finally {
    await telemetry?.shutdown();
  }
};
