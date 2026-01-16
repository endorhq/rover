import colors from 'ansi-colors';
import { existsSync } from 'node:fs';
import { Git, showList, showTitle } from 'rover-core';
import { TaskNotFoundError } from 'rover-schemas';
import { getTelemetry } from '../lib/telemetry.js';
import { showTips } from '../utils/display.js';
import { exitWithError, exitWithSuccess } from '../utils/exit.js';
import { requireProjectContext } from '../lib/context.js';

export const diffCommand = async (
  taskId: string,
  filePath?: string,
  options: { onlyFiles?: boolean; branch?: string } = {}
) => {
  const telemetry = getTelemetry();
  // Convert string taskId to number
  const numericTaskId = parseInt(taskId, 10);
  if (isNaN(numericTaskId)) {
    await exitWithError(
      {
        success: false,
        error: `Invalid task ID '${taskId}' - must be a number`,
      },
      { telemetry }
    );
    return;
  }

  // Require project context
  let project;
  try {
    project = await requireProjectContext();
  } catch (error) {
    await exitWithError(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { telemetry }
    );
    return;
  }

  try {
    const git = new Git();

    // Load task using ProjectManager
    const task = project.getTask(numericTaskId);
    if (!task) {
      throw new TaskNotFoundError(numericTaskId);
    }

    // Check if worktree exists
    if (!task.worktreePath || !existsSync(task.worktreePath)) {
      await exitWithError(
        {
          success: false,
          error: `No workspace found for task '${numericTaskId}'`,
        },
        {
          tips: [
            colors.gray('  Run ') +
              colors.cyan(`rover task ${numericTaskId}`) +
              colors.gray(' first'),
          ],
          telemetry,
        }
      );
      return;
    }

    // Check if we're in a git repository
    if (!git.isGitRepo()) {
      await exitWithError(
        {
          success: false,
          error: 'Not in a git repository',
        },
        { telemetry }
      );
      return;
    }

    console.log(colors.bold(`Task ${numericTaskId} Changes`));
    console.log(colors.gray('├── Title: ') + task.title);
    console.log(colors.gray('├── Workspace: ') + task.worktreePath);

    if (options.branch) {
      console.log(colors.gray('├── Task Branch: ') + task.branchName);
      console.log(
        colors.gray('└── Comparing with: ') + colors.cyan(options.branch)
      );
    } else {
      console.log(colors.gray('└── Task Branch: ') + task.branchName);
    }

    telemetry?.eventDiff();

    try {
      // Execute git diff command
      try {
        if (options.onlyFiles) {
          // Show only changed files with stats
          const diffResult = await git.diffStats({
            worktreePath: task.worktreePath,
            filePath: filePath,
            branch: options.branch,
            includeUntracked: !options.branch,
          });

          if (diffResult.files.length === 0) {
            if (filePath) {
              console.log(
                colors.yellow(`No changes found for file: ${filePath}`)
              );
            } else {
              console.log(colors.yellow('No changes found in workspace'));
            }
          } else {
            showTitle('Changed Files');
            // Display file list with colors
            const changedFiles: string[] = [];

            diffResult.files.forEach(file => {
              const insertions =
                file.insertions > 0 ? colors.green(`+${file.insertions}`) : '0';
              const deletions =
                file.deletions > 0 ? colors.red(`-${file.deletions}`) : '0';
              changedFiles.push(
                `${insertions} ${deletions} ${colors.cyan(file.path)}`
              );
            });

            showList(changedFiles);
          }
        } else {
          // Regular diff
          const diffResult = git.diff({
            worktreePath: task.worktreePath,
            filePath: filePath,
            onlyFiles: options.onlyFiles,
            branch: options.branch,
            includeUntracked: !options.branch, // Only include untracked when not comparing branches
          });

          const diffOutput = diffResult.stdout?.toString();

          if (diffOutput?.trim() === '') {
            // No differences found
            if (filePath) {
              console.log(
                colors.yellow(`No changes found for file: ${filePath}`)
              );
            } else {
              console.log(colors.yellow('No changes found in workspace'));
            }
          } else {
            // Display full diff with syntax highlighting
            console.log('');
            const lines = diffOutput?.split('\n') || [];
            lines.forEach(line => {
              if (line.startsWith('@@')) {
                console.log(colors.magenta(line));
              } else if (line.startsWith('+') && !line.startsWith('+++')) {
                console.log(colors.green(line));
              } else if (line.startsWith('-') && !line.startsWith('---')) {
                console.log(colors.red(line));
              } else if (line.startsWith('diff --git')) {
                console.log(colors.bold(line));
              } else if (
                line.startsWith('index ') ||
                line.startsWith('+++') ||
                line.startsWith('---')
              ) {
                console.log(colors.gray(line));
              } else {
                console.log(line);
              }
            });
          }
        }
      } catch (gitError: any) {
        if (gitError.status === 1 && gitError.stderr.toString().trim() === '') {
          // Exit code 1 with no stderr usually means no differences
          if (filePath) {
            console.log(
              colors.yellow(`No changes found for file: ${filePath}`)
            );
          } else {
            console.log(colors.yellow('No changes found in workspace'));
          }
        } else {
          console.error(colors.red('Error running git diff:'), gitError);
          if (gitError.stderr) {
            console.error(colors.red(gitError.stderr.toString()));
          }
        }
      }
    } catch (error: any) {
      console.error(colors.red('Error accessing workspace:'), error.message);
    }

    // Show additional context if not showing only files
    const tips = [];

    if (!options.onlyFiles) {
      tips.push(
        'Use ' +
          colors.cyan(`rover diff ${numericTaskId} --only-files`) +
          ' to see only changed filenames'
      );
    }

    if (!filePath) {
      tips.push(
        'Use ' +
          colors.cyan(`rover diff ${numericTaskId} <file>`) +
          ' to see diff for a specific file'
      );
    }

    if (!options.branch) {
      tips.push(
        'Use ' +
          colors.cyan(`rover diff ${numericTaskId} --branch <branchName>`) +
          ' to compare changes with a specific branch'
      );
    }

    if (tips.length > 0) {
      showTips(tips);
    }

    await exitWithSuccess(null, { success: true }, { telemetry });
    return;
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      await exitWithError(
        { success: false, error: error.message },
        { telemetry }
      );
    } else {
      await exitWithError(
        { success: false, error: `Error showing task diff: ${error}` },
        { telemetry }
      );
    }
  }
};
