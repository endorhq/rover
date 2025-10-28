import colors from 'ansi-colors';
import { formatTaskStatus, statusColor } from '../utils/task-status.js';
import {
  TaskDescription,
  TaskNotFoundError,
  type TaskStatus,
} from '../lib/description.js';
import { join } from 'node:path';
import { getTelemetry } from '../lib/telemetry.js';
import {
  findProjectRoot,
  showFile,
  showList,
  showProperties,
  showTips,
  showTitle,
} from 'rover-common';
import { IterationConfig } from '../lib/iteration.js';

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
 * Build the error JSON output with consistent TaskInspectionOutput shape
 */
const jsonErrorOutput = (
  error: string,
  taskId?: number,
  task?: TaskDescription
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
  options: { json?: boolean; file?: string[] } = {}
) => {
  // Convert string taskId to number
  const numericTaskId = parseInt(taskId, 10);

  if (isNaN(numericTaskId)) {
    if (options.json) {
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

  const telemetry = getTelemetry();
  telemetry?.eventInspectTask();

  try {
    // Load task using TaskDescription
    const task = TaskDescription.load(numericTaskId);

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
    const iteration = IterationConfig.load(iterationPath);

    if (options.json) {
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
        'Git Workspace': `${task.worktreePath} (${colors.gray(task.branchName)})`,
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

      const discoveredFiles = iteration.listMarkdownFiles();

      if (discoveredFiles.length > 0) {
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
            showFile(file, contents);
          });
        }

        showTitle(
          `Generated Workflow Files ${colors.gray(`| Iteration ${iterationNumber}/${task.iterations}`)}`
        );
        showList(discoveredFiles);
      }

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
      if (options.json) {
        const errorOutput = jsonErrorOutput(error.message, numericTaskId);
        console.log(JSON.stringify(errorOutput, null, 2));
      } else {
        console.log(colors.red(`✗ ${error.message}`));
      }
    } else {
      if (options.json) {
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
