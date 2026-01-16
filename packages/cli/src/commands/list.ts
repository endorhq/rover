import colors from 'ansi-colors';
import {
  IterationManager,
  IterationStatusManager,
  ProjectConfigManager,
  ProjectStore,
  showTips,
  Table,
  TableColumn,
  TaskDescriptionStore,
  UserSettingsManager,
  VERBOSE,
} from 'rover-core';
import { type TaskDescription } from 'rover-schemas';
import {
  isJsonMode,
  setJsonMode,
  resolveProjectContext,
} from '../lib/context.js';
import { executeHooks } from '../lib/hooks.js';
import { getTelemetry } from '../lib/telemetry.js';
import { formatTaskStatus, statusColor } from '../utils/task-status.js';

/**
 * Track previous task statuses to detect transitions for onComplete hooks.
 * Module-level to persist across watch mode polling cycles.
 */
const previousTaskStatuses = new Map<number, string>();

/**
 * Format duration from start to now or completion
 */
const formatDuration = (startTime?: string, endTime?: string): string => {
  if (!startTime) {
    return 'never';
  }

  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date();
  const diffMs = end.getTime() - start.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
};

/**
 * Format progress bar
 */
const formatProgress = (step?: string, progress?: number): string => {
  if (step === undefined || progress === undefined) return colors.gray('─────');

  const barLength = 8;
  const filled = Math.round((progress / 100) * barLength);
  const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

  if (step === 'FAILED') {
    return colors.red(bar);
  } else if (['COMPLETED', 'MERGED', 'PUSHED'].includes(step)) {
    return colors.green(bar);
  } else {
    return colors.cyan(bar);
  }
};

/**
 * Row data for the table
 */
interface TaskRow {
  id: string;
  title: string;
  agent: string;
  workflow: string;
  status: string;
  progress: number;
  currentStep: string;
  duration: string;
  error?: string;
}

export const listCommand = async (
  options: {
    watch?: boolean | string;
    verbose?: boolean;
    json?: boolean;
    watching?: boolean;
  } = {}
) => {
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

  const telemetry = getTelemetry();

  try {
    const tasks = TaskDescriptionStore.getAllDescriptions();

    if (!options.watching) {
      telemetry?.eventListTasks();
    }

    if (tasks.length === 0) {
      if (isJsonMode()) {
        console.log(JSON.stringify([]));
      } else {
        console.log(colors.yellow('📋 No tasks found'));

        if (!options.watch) {
          showTips(
            'Use ' +
              colors.cyan('rover task') +
              ' to assign a new task to an agent'
          );
        }
      }

      // Don't return early if in watch mode - continue to watch for new tasks
      if (!options.watch) {
        return;
      }
    }

    // Load project config for hooks (outside loop for efficiency)
    let projectConfig: ProjectConfigManager | undefined;
    try {
      projectConfig = ProjectConfigManager.load();
    } catch {
      // Project config is optional, continue without hooks
    }

    // Update task status and detect transitions for onComplete hooks
    tasks.forEach(task => {
      try {
        // Get previous status before update
        const previousStatus = previousTaskStatuses.get(task.id);

        // Update status from iteration
        task.updateStatusFromIteration();
        const currentStatus = task.status;

        // Detect NEW transition to COMPLETED or FAILED
        const isNewCompletion =
          previousStatus !== currentStatus &&
          (currentStatus === 'COMPLETED' || currentStatus === 'FAILED');

        // Execute onComplete hooks if configured and this is a new completion
        if (isNewCompletion && projectConfig?.hooks?.onComplete?.length) {
          executeHooks(
            projectConfig.hooks.onComplete,
            {
              taskId: task.id,
              taskBranch: task.branchName,
              taskTitle: task.title,
              taskStatus: currentStatus.toLowerCase(),
            },
            'onComplete'
          );
        }

        // Update tracking for next iteration
        previousTaskStatuses.set(task.id, currentStatus);
      } catch (err) {
        if (!isJsonMode()) {
          console.log(
            `\n${colors.yellow(`⚠ Failed to update the status of task ${task.id}`)}`
          );
        }

        if (VERBOSE) {
          console.error(colors.gray(`Error details: ${err}`));
        }
      }
    });

    // JSON output mode
    if (isJsonMode()) {
      const jsonOutput: Array<
        TaskDescription & { iterationsData: IterationManager[] }
      > = [];

      tasks.forEach(task => {
        let iterationsData: IterationManager[] = [];
        try {
          iterationsData = task.getIterations();
        } catch (err) {
          if (VERBOSE) {
            console.error(
              colors.gray(
                `Failed to retrieve the iterations details for task ${task.id}`
              )
            );
            console.error(colors.gray(`Error details: ${err}`));
          }
        }

        jsonOutput.push({
          ...task.rawData,
          iterationsData,
        });
      });

      console.log(JSON.stringify(jsonOutput, null, 2));
      return;
    }

    // Helper to safely get iteration status
    const maybeIterationStatus = (
      iteration?: IterationManager
    ): IterationStatusManager | undefined => {
      try {
        return iteration?.status();
      } catch (e) {
        return undefined;
      }
    };

    // Prepare table data
    const tableData: TaskRow[] = tasks.map(task => {
      const lastIteration = task.getLastIteration();
      const taskStatus = task.status;
      const startedAt = task.startedAt;

      // Determine end time based on task status
      let endTime: string | undefined;
      if (taskStatus === 'FAILED') {
        endTime = task.failedAt;
      } else if (['COMPLETED', 'MERGED', 'PUSHED'].includes(taskStatus)) {
        endTime = task.completedAt;
      }

      const iterationStatus = maybeIterationStatus(lastIteration);

      // Format agent with model (e.g., "claude:sonnet")
      let agentDisplay = task.agent || '-';
      if (task.agent && task.agentModel) {
        agentDisplay = `${task.agent}:${task.agentModel}`;
      }

      return {
        id: task.id.toString(),
        title: task.title || 'Unknown Task',
        agent: agentDisplay,
        workflow: task.workflowName || '-',
        status: taskStatus,
        progress: iterationStatus?.progress || 0,
        currentStep: iterationStatus?.currentStep || '-',
        duration: iterationStatus ? formatDuration(startedAt, endTime) : '-',
        error: task.error,
      };
    });

    // Define table columns
    const columns: TableColumn<TaskRow>[] = [
      {
        header: 'ID',
        key: 'id',
        maxWidth: 4,
        format: (value: string) => colors.cyan(value),
      },
      {
        header: 'Title',
        key: 'title',
        minWidth: 15,
        maxWidth: 30,
        truncate: 'ellipsis',
      },
      {
        header: 'Agent',
        key: 'agent',
        minWidth: 8,
        maxWidth: 16,
        truncate: 'ellipsis',
        format: (value: string) => colors.gray(value),
      },
      {
        header: 'Workflow',
        key: 'workflow',
        minWidth: 8,
        maxWidth: 12,
        truncate: 'ellipsis',
        format: (value: string) => colors.gray(value),
      },
      {
        header: 'Status',
        key: 'status',
        width: 12,
        format: (value: string) => {
          const colorFunc = statusColor(value);
          return colorFunc(formatTaskStatus(value));
        },
      },
      {
        header: 'Progress',
        key: 'progress',
        format: (_value: string, row: TaskRow) =>
          formatProgress(row.status, row.progress),
        width: 10,
      },
      {
        header: 'Current Step',
        key: 'currentStep',
        minWidth: 15,
        maxWidth: 25,
        truncate: 'ellipsis',
        format: (value: string) => colors.gray(value),
      },
      {
        header: 'Duration',
        key: 'duration',
        width: 10,
        format: (value: string) => colors.gray(value),
      },
    ];

    // Render the table
    const table = new Table(columns);
    table.render(tableData);

    // Show errors in verbose mode
    if (options.verbose) {
      tableData.forEach(row => {
        if (row.error) {
          console.log(colors.red(`    Error for task ${row.id}: ${row.error}`));
        }
      });
    }

    // Watch mode (configurable refresh interval, default 3 seconds)
    if (options.watch) {
      // CLI argument takes precedence, then settings, then default (3s)
      let intervalSeconds: number;
      if (typeof options.watch === 'string') {
        intervalSeconds = parseInt(options.watch, 10);
        if (
          isNaN(intervalSeconds) ||
          intervalSeconds < 1 ||
          intervalSeconds > 60
        ) {
          console.error(
            colors.red('Watch interval must be between 1 and 60 seconds')
          );
          return;
        }
      } else {
        const settings = UserSettingsManager.load();
        intervalSeconds = settings.watchIntervalSeconds;
      }
      const intervalMs = intervalSeconds * 1000;

      console.log(
        colors.gray(
          `\n⏱️  Watching for changes every ${intervalSeconds}s (Ctrl+C to exit)...`
        )
      );

      const watchInterval = setInterval(async () => {
        // Clear screen and show updated status
        process.stdout.write('\x1b[2J\x1b[0f');
        await listCommand({ ...options, watch: false, watching: true });
        console.log(
          colors.gray(
            `\n⏱️  Refreshing every ${intervalSeconds}s (Ctrl+C to exit)...`
          )
        );
      }, intervalMs);

      // Handle Ctrl+C
      process.on('SIGINT', () => {
        clearInterval(watchInterval);
        process.exit(0);
      });
    }

    if (!options.watch && !options.watching) {
      showTips([
        'Use ' +
          colors.cyan('rover task') +
          ' to assign a new task to an agent',
        'Use ' + colors.cyan('rover inspect <id>') + ' to see the task details',
      ]);
    }
  } catch (error) {
    console.error(colors.red('Error getting task status:'), error);
  } finally {
    await telemetry?.shutdown();
  }
};
