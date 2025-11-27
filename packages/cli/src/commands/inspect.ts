import colors from 'ansi-colors';
import { formatTaskStatus, statusColor } from '../utils/task-status.js';
import {
  TaskDescriptionManager,
  TaskNotFoundError,
  type TaskStatus,
} from 'rover-schemas';
import { join } from 'node:path';
import { getTelemetry } from '../lib/telemetry.js';
import {
  findProjectRoot,
  Git,
  showFile,
  showList,
  showProperties,
  showTips,
  showTitle,
} from 'rover-common';
import { IterationManager } from 'rover-schemas';
import { isJsonMode, setJsonMode } from '../lib/global-state.js';

const DEFAULT_FILE_CONTENTS = 'summary.md';

/**
 * JSON output format for task inspection containing task metadata, status, and iteration details
 */
interface TaskInspectionOutput {
  /** Git branch name for the task worktree */
  branchName: string;
  /** ISO timestamp when task was completed */
  completedAt?: string;
  /** ISO timestamp when task was created */
  createdAt: string;
  /** Full description of the task */
  description: string;
  /** Error message if task failed */
  error?: string;
  /** ISO timestamp when task failed */
  failedAt?: string;
  /** List of files in the current iteration directory */
  files?: string[];
  /** Human-readable status string */
  formattedStatus: string;
  /** Numeric task identifier */
  id: number;
  /** List of markdown files in the iteration directory */
  iterationFiles?: string[];
  /** Total number of iterations for this task */
  iterations: number;
  /** ISO timestamp of the most recent iteration */
  lastIterationAt?: string;
  /** ISO timestamp when task execution started */
  startedAt?: string;
  /** Current task status */
  status: TaskStatus;
  /** Whether the task status has been updated */
  statusUpdated: boolean;
  /** Path to task directory in .rover/tasks */
  taskDirectory: string;
  /** Short title of the task */
  title: string;
  /** Unique identifier for the task */
  uuid: string;
  /** Workflow name */
  workflowName: string;
  /** Path to the git worktree for this task */
  worktreePath: string;
}

/**
 * JSON output format for raw file content
 */
interface RawFileOutput {
  /** Whether the files were successfully read */
  success: boolean;
  /** List of files */
  files: Array<{ filename: string; content: string }>;
  /** Error reading the file */
  error?: string;
}

/**
 * Build the error JSON output with consistent TaskInspectionOutput shape
 */
const jsonErrorOutput = (
  error: string,
  taskId?: number,
  task?: TaskDescriptionManager
): TaskInspectionOutput => {
  return {
    branchName: task?.branchName || '',
    completedAt: task?.completedAt,
    createdAt: task?.createdAt || new Date().toISOString(),
    description: task?.description || '',
    error: error,
    failedAt: task?.failedAt,
    files: [],
    formattedStatus: task ? formatTaskStatus(task.status) : 'Failed',
    id: task?.id || taskId || 0,
    iterations: task?.iterations || 0,
    lastIterationAt: task?.lastIterationAt,
    startedAt: task?.startedAt,
    status: task?.status || 'FAILED',
    statusUpdated: false,
    taskDirectory: `.rover/tasks/${taskId || 0}/`,
    title: task?.title || 'Unknown Task',
    uuid: task?.uuid || '',
    workflowName: task?.workflowName || '',
    worktreePath: task?.worktreePath || '',
  };
};

export const inspectCommand = async (
  taskId: string,
  iterationNumber?: number,
  options: { json?: boolean; file?: string[]; rawFile?: string[] } = {}
) => {
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

  // Convert string taskId to number
  const numericTaskId = parseInt(taskId, 10);

  if (isNaN(numericTaskId)) {
    if (isJsonMode()) {
      const errorOutput = jsonErrorOutput(
        `Invalid task ID '${taskId}' - must be a number`
      );
      console.log(JSON.stringify(errorOutput, null, 2));
    } else {
      console.log(
        colors.red(`✗ Invalid task ID '${taskId}' - must be a number`)
      );
      showTips([
        colors.gray('Run the ') +
          colors.cyan('rover inspect 1') +
          colors.gray(' to get the task details'),
      ]);
    }
    return;
  }

  // Validate mutually exclusive options
  if (options.file && options.rawFile) {
    if (isJsonMode()) {
      const errorOutput = jsonErrorOutput(
        'Cannot use both --file and --raw-file options together'
      );
      console.log(JSON.stringify(errorOutput, null, 2));
    } else {
      console.log(
        colors.red('✗ Cannot use both --file and --raw-file options together')
      );
      showTips([
        'Use ' +
          colors.cyan('--file') +
          ' for formatted output or ' +
          colors.cyan('--raw-file') +
          ' for raw output',
      ]);
    }
    return;
  }

  const telemetry = getTelemetry();
  telemetry?.eventInspectTask();

  try {
    // Load task using TaskDescription
    const task = TaskDescriptionManager.load(numericTaskId);

    if (iterationNumber === undefined) {
      iterationNumber = task.iterations;
    }

    // Load the iteration config
    const iterationPath = join(
      findProjectRoot(),
      '.rover',
      'tasks',
      numericTaskId.toString(),
      'iterations',
      iterationNumber.toString()
    );
    const iteration = IterationManager.load(iterationPath);

    // Handle --raw-file option
    if (options.rawFile) {
      const rawFileContents = iteration.getMarkdownFiles(options.rawFile);

      if (isJsonMode()) {
        // Output JSON format with RawFileOutput array
        const rawFileOutput: RawFileOutput = {
          success: true,
          files: [],
        };
        for (const [filename, content] of rawFileContents.entries()) {
          rawFileOutput.files.push({
            filename,
            content,
          });
        }
        // Add entries for files that were not found
        for (const requestedFile of options.rawFile) {
          if (!rawFileContents.has(requestedFile)) {
            rawFileOutput.files.push({
              filename: requestedFile,
              content: '',
            });
            rawFileOutput.success = false;
            rawFileOutput.error = `Error reading file ${requestedFile}. It was not present in the task output.`;
          }
        }
        console.log(JSON.stringify(rawFileOutput, null, 2));
      } else {
        // Output raw content without formatting
        if (rawFileContents.size === 0) {
          console.error(
            colors.red(
              `✗ No files found matching: ${options.rawFile.join(', ')}`
            )
          );
        } else {
          rawFileContents.forEach(content => {
            console.log(content);
          });
        }
      }
      await telemetry?.shutdown();
      // Return at this point
      return;
    }

    if (isJsonMode()) {
      // Output JSON format
      const jsonOutput: TaskInspectionOutput = {
        branchName: task.branchName,
        completedAt: task.completedAt,
        createdAt: task.createdAt,
        description: task.description,
        error: task.error,
        failedAt: task.failedAt,
        files: iteration.listMarkdownFiles(),
        formattedStatus: formatTaskStatus(task.status),
        id: task.id,
        iterationFiles: iteration.listMarkdownFiles(),
        iterations: task.iterations,
        lastIterationAt: task.lastIterationAt,
        startedAt: task.startedAt,
        status: task.status,
        statusUpdated: false, // TODO: Implement status checking in TaskDescription
        taskDirectory: `.rover/tasks/${numericTaskId}/`,
        title: task.title,
        uuid: task.uuid,
        workflowName: task.workflowName,
        worktreePath: task.worktreePath,
      };

      console.log(JSON.stringify(jsonOutput, null, 2));
    } else {
      // Format status with user-friendly names
      const formattedStatus = formatTaskStatus(task.status);

      // Status color
      const statusColorFunc = statusColor(task.status);

      showTitle('Details');

      const properties: Record<string, string> = {
        ID: `${task.id.toString()} (${colors.gray(task.uuid)})`,
        Title: task.title,
        Status: statusColorFunc(formattedStatus),
        Workflow: task.workflowName,
        'Created At': new Date(task.createdAt).toLocaleString(),
      };

      if (task.completedAt) {
        properties['Completed At'] = new Date(
          task.completedAt
        ).toLocaleString();
      } else if (task.failedAt) {
        properties['Failed At'] = new Date(task.failedAt).toLocaleString();
      }

      // Show error if failed
      if (task.error) {
        properties['Error'] = colors.red(task.error);
      }

      showProperties(properties);

      // Workspace information
      showTitle('Workspace');

      const workspaceProps: Record<string, string> = {
        'Branch Name': task.branchName,
        'Git Workspace path': task.worktreePath,
      };

      showProperties(workspaceProps);

      // Workflow files
      const discoveredFiles = iteration.listMarkdownFiles();

      if (discoveredFiles.length > 0) {
        showTitle(
          `Workflow Output ${colors.gray(`| Iteration ${iterationNumber}/${task.iterations}`)}`
        );
        showList(discoveredFiles);

        // Show the summary file by default only when it's available
        const hasSummary = discoveredFiles.includes(DEFAULT_FILE_CONTENTS);
        const fileFilter = options.file || [
          hasSummary
            ? DEFAULT_FILE_CONTENTS
            : discoveredFiles[discoveredFiles.length - 1],
        ];

        const iterationFileContents = iteration.getMarkdownFiles(fileFilter);
        if (iterationFileContents.size === 0) {
          console.log(
            colors.gray(
              `\nNo content for the ${fileFilter.join(', ')} files found for iteration ${iterationNumber}.`
            )
          );
        } else {
          console.log();
          iterationFileContents.forEach((contents, file) => {
            showFile(file, contents.trim());
          });
        }
      }

      // Show file changes
      const git = new Git();
      const stats = await git.diffStats({
        worktreePath: task.worktreePath,
        includeUntracked: true,
      });

      const statFiles = stats.files.map(fileStat => {
        const insertions =
          fileStat.insertions > 0
            ? colors.green(`+${fileStat.insertions}`)
            : '';
        const deletions =
          fileStat.deletions > 0 ? colors.red(`-${fileStat.deletions}`) : '';
        return `${insertions} ${deletions} ${colors.cyan(fileStat.path)}`;
      });

      showTitle('File Changes');
      showList(statFiles);

      const tips = [];

      if (task.status === 'NEW' || task.status === 'FAILED') {
        tips.push(
          'Use ' + colors.cyan(`rover restart ${taskId}`) + ' to retry it'
        );
      } else if (options.file == null && discoveredFiles.length > 0) {
        tips.push(
          'Use ' +
            colors.cyan(
              `rover inspect ${taskId} --file ${discoveredFiles[0]}`
            ) +
            ' to read its content'
        );
      }

      showTips([
        ...tips,
        'Use ' +
          colors.cyan(`rover iterate ${taskId}`) +
          ' to start a new agent iteration on this task',
      ]);
    }

    await telemetry?.shutdown();
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      if (isJsonMode()) {
        const errorOutput = jsonErrorOutput(error.message, numericTaskId);
        console.log(JSON.stringify(errorOutput, null, 2));
      } else {
        console.log(colors.red(`✗ ${error.message}`));
      }
    } else {
      if (isJsonMode()) {
        const errorOutput = jsonErrorOutput(
          `Error inspecting task: ${error}`,
          numericTaskId
        );
        console.log(JSON.stringify(errorOutput, null, 2));
      } else {
        console.error(colors.red('Error inspecting task:'), error);
      }
    }
  }
};
