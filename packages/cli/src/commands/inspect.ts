import colors from 'ansi-colors';
import { formatTaskStatus, statusColor } from '../utils/task-status.js';
import {
  Git,
  IterationManager,
  showFile,
  showList,
  showProperties,
  showTips,
  showTitle,
  type TaskDescriptionManager,
} from 'rover-core';
import { TaskNotFoundError, type TaskStatus } from 'rover-schemas';
import { join } from 'node:path';
import { getTelemetry } from '../lib/telemetry.js';
import {
  isJsonMode,
  setJsonMode,
  requireProjectContext,
} from '../lib/context.js';
import { exitWithError, exitWithSuccess } from '../utils/exit.js';

const DEFAULT_FILE_CONTENTS = 'summary.md';

/**
 * File change statistics for a single file
 */
interface FileChangeStat {
  /** File path relative to worktree */
  path: string;
  /** Number of lines added */
  insertions: number;
  /** Number of lines deleted */
  deletions: number;
}

/**
 * JSON output format for task inspection containing task metadata, status, and iteration details
 */
interface TaskInspectionOutput {
  /** Whether the operation was successful */
  success: boolean;
  /** The base commit hash when the worktree was created */
  baseCommit?: string;
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
  /** List of file changes with insertions/deletions stats */
  fileChanges?: FileChangeStat[];
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
  /** The source branch from which this task was created */
  sourceBranch?: string;
  /** ISO timestamp when task execution started */
  startedAt?: string;
  /** Current task status */
  status: TaskStatus;
  /** Whether the task status has been updated */
  statusUpdated: boolean;
  /** Content of summary.md file if available */
  summary?: string;
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
    success: false,
    baseCommit: task?.baseCommit,
    branchName: task?.branchName || '',
    completedAt: task?.completedAt,
    createdAt: task?.createdAt || new Date().toISOString(),
    description: task?.description || '',
    error: error,
    failedAt: task?.failedAt,
    fileChanges: [],
    files: [],
    formattedStatus: task ? formatTaskStatus(task.status) : 'Failed',
    id: task?.id || taskId || 0,
    iterations: task?.iterations || 0,
    lastIterationAt: task?.lastIterationAt,
    sourceBranch: task?.sourceBranch,
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

  const telemetry = getTelemetry();
  telemetry?.eventInspectTask();

  // Convert string taskId to number
  const numericTaskId = parseInt(taskId, 10);

  if (isNaN(numericTaskId)) {
    const errorOutput = jsonErrorOutput(
      `Invalid task ID '${taskId}' - must be a number`
    );
    await exitWithError(errorOutput, {
      tips: [
        colors.gray('Run the ') +
          colors.cyan('rover inspect 1') +
          colors.gray(' to get the task details'),
      ],
      telemetry,
    });
    return;
  }

  // Validate mutually exclusive options
  if (options.file && options.rawFile) {
    const errorOutput = jsonErrorOutput(
      'Cannot use both --file and --raw-file options together'
    );
    await exitWithError(errorOutput, {
      tips: [
        'Use ' +
          colors.cyan('--file') +
          ' for formatted output or ' +
          colors.cyan('--raw-file') +
          ' for raw output',
      ],
      telemetry,
    });
    return;
  }

  // Require project context
  let project;
  try {
    project = await requireProjectContext();
  } catch (error) {
    const errorOutput = jsonErrorOutput(
      error instanceof Error ? error.message : String(error),
      numericTaskId
    );
    await exitWithError(errorOutput, { telemetry });
    return;
  }

  try {
    // Load task using ProjectManager
    const task = project.getTask(numericTaskId);
    if (!task) {
      throw new TaskNotFoundError(numericTaskId);
    }

    if (iterationNumber === undefined) {
      iterationNumber = task.iterations;
    }

    // Load the iteration config
    const iterationPath = join(
      task.iterationsPath(),
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
        if (rawFileOutput.success) {
          await exitWithSuccess(null, { success: true }, { telemetry });
        } else {
          await exitWithError(
            { success: false, error: rawFileOutput.error },
            { telemetry }
          );
        }
        return;
      } else {
        // Output raw content without formatting
        if (rawFileContents.size === 0) {
          const errorOutput = jsonErrorOutput(
            `No files found matching: ${options.rawFile.join(', ')}`,
            numericTaskId,
            task
          );
          await exitWithError(errorOutput, { telemetry });
          return;
        } else {
          rawFileContents.forEach(content => {
            console.log(content);
          });
          await exitWithSuccess(null, { success: true }, { telemetry });
          return;
        }
      }
    }

    if (isJsonMode()) {
      // Get summary content if available
      const summaryFiles = iteration.getMarkdownFiles([DEFAULT_FILE_CONTENTS]);
      const summaryContent = summaryFiles.get(DEFAULT_FILE_CONTENTS)?.trim();

      // Get file changes for non-active tasks
      let fileChanges: FileChangeStat[] | undefined;
      if (!task.isActive()) {
        const git = new Git({ cwd: project.path });
        const stats = await git.diffStats({
          worktreePath: task.worktreePath,
          includeUntracked: true,
        });
        fileChanges = stats.files.map(fileStat => ({
          path: fileStat.path,
          insertions: fileStat.insertions,
          deletions: fileStat.deletions,
        }));
      }

      // Output JSON format
      const jsonOutput: TaskInspectionOutput = {
        success: true,
        baseCommit: task.baseCommit,
        branchName: task.branchName,
        completedAt: task.completedAt,
        createdAt: task.createdAt,
        description: task.description,
        error: task.error,
        failedAt: task.failedAt,
        fileChanges,
        files: iteration.listMarkdownFiles(),
        formattedStatus: formatTaskStatus(task.status),
        id: task.id,
        iterationFiles: iteration.listMarkdownFiles(),
        iterations: task.iterations,
        lastIterationAt: task.lastIterationAt,
        sourceBranch: task.sourceBranch,
        startedAt: task.startedAt,
        status: task.status,
        statusUpdated: false, // TODO: Implement status checking in TaskDescription
        summary: summaryContent,
        taskDirectory: task.getBasePath(),
        title: task.title,
        uuid: task.uuid,
        workflowName: task.workflowName,
        worktreePath: task.worktreePath,
      };

      console.log(JSON.stringify(jsonOutput, null, 2));
      await exitWithSuccess(null, { success: true }, { telemetry });
      return;
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

      // Show file changes only if task is not in an active state
      if (!task.isActive()) {
        const git = new Git({ cwd: project.path });
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

    await exitWithSuccess(null, { success: true }, { telemetry });
    return;
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      const errorOutput = jsonErrorOutput(error.message, numericTaskId);
      await exitWithError(errorOutput, { telemetry });
    } else {
      const errorOutput = jsonErrorOutput(
        `Error inspecting task: ${error}`,
        numericTaskId
      );
      await exitWithError(errorOutput, { telemetry });
    }
  }
};
