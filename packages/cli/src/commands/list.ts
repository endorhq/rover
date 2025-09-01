import colors from 'ansi-colors';
import { getAllTaskStatuses, updateTaskWithStatus } from '../utils/status.js';
import { formatTaskStatus, statusColor } from '../utils/task-status.js';
import { showTips } from '../utils/display.js';
import { getTelemetry } from '../lib/telemetry.js';

/**
 * Format duration from start to now or completion
 */
const formatDuration = (startTime: string, endTime?: string): string => {
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

  if (step === 'failed') {
    return colors.red(bar);
  } else if (['completed', 'merged', 'pushed'].includes(step)) {
    return colors.green(bar);
  } else {
    return colors.cyan(bar);
  }
};

/**
 * Truncate text to fit column width
 */
const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
};

export const listCommand = async (
  options: {
    watch?: boolean;
    verbose?: boolean;
    json?: boolean;
    watching?: boolean;
  } = {}
) => {
  const telemetry = getTelemetry();
  try {
    const allStatuses = getAllTaskStatuses();

    if (!options.watching) {
      telemetry?.eventListTasks();
    }

    if (allStatuses.length === 0) {
      if (options.json) {
        console.log(JSON.stringify([]));
      } else {
        console.log(colors.yellow('📋 No tasks found'));

        showTips([
          'Use ' +
            colors.cyan('rover task') +
            ' to assign a new task to an agent',
        ]);
      }
      return;
    }
    // Update task metadata with latest status information
    for (const { taskId, status } of allStatuses) {
      if (status) {
        updateTaskWithStatus(taskId, status);
      }
    }

    // JSON output mode
    if (options.json) {
      const jsonOutput = allStatuses.map(({ taskId, status, taskData }) => ({
        id: taskId,
        title: taskData?.title || 'Unknown Task',
        status: status?.status || 'unknown',
        progress: status?.progress,
        currentStep: status?.currentStep || '',
        startedAt: status?.startedAt,
        completedAt: status?.completedAt,
        error: status?.error,
      }));
      console.log(JSON.stringify(jsonOutput, null, 2));
      return;
    }

    // Table headers
    const headers = [
      'ID',
      'Title',
      'Status',
      'Progress',
      'Current Step',
      'Duration',
    ];
    const columnWidths = [4, 35, 12, 10, 30, 10];

    // Print header
    let headerRow = '';
    headers.forEach((header, index) => {
      headerRow += colors.bold(
        colors.white(header.padEnd(columnWidths[index]))
      );
    });
    console.log(headerRow);

    // Print separator
    let separatorRow = '';
    columnWidths.forEach(width => {
      separatorRow += '─'.repeat(width);
    });
    console.log(colors.gray(separatorRow));

    const lastIterationOrTaskProperty = ({
      status,
      taskData,
      attribute,
      defaultValue,
    }: {
      status?: any;
      taskData: any;
      attribute: string;
      defaultValue?: any;
    }): any => {
      if (status && status[attribute]) {
        return status[attribute];
      }
      if (taskData && taskData[attribute]) {
        return taskData[attribute];
      }
      return defaultValue;
    };

    // Print rows
    for (const { taskId, status, taskData } of allStatuses) {
      const title = taskData?.title || 'Unknown Task';
      const taskStatus = lastIterationOrTaskProperty({
        status,
        taskData,
        attribute: 'status',
      });
      const startedAt = lastIterationOrTaskProperty({
        status,
        taskData,
        attribute: 'startedAt',
      });

      // Determine end time based on task status
      let endTime: string | undefined;
      if (taskStatus === 'failed') {
        endTime = lastIterationOrTaskProperty({
          status,
          taskData,
          attribute: 'failedAt',
        });
      } else if (['completed', 'merged', 'pushed'].includes(taskStatus)) {
        endTime = lastIterationOrTaskProperty({
          status,
          taskData,
          attribute: 'completedAt',
        });
      }

      const duration = formatDuration(startedAt, endTime);
      const colorFunc = statusColor(taskStatus);

      let row = '';
      row += colors.cyan(taskId.padEnd(columnWidths[0]));
      row += colors.white(
        truncateText(title, columnWidths[1] - 1).padEnd(columnWidths[1])
      );
      row += colorFunc(formatTaskStatus(taskStatus).padEnd(columnWidths[2])); // +10 for ANSI codes
      row += formatProgress(taskStatus, status?.progress || 0).padEnd(
        columnWidths[3] + 10
      );
      row += colors.gray(
        truncateText(status?.currentStep || '-', columnWidths[4] - 1).padEnd(
          columnWidths[4]
        )
      );
      row += colors.gray(status ? duration : '-');
      console.log(row);

      // Show error in verbose mode
      if (options.verbose && status?.error) {
        console.log(colors.red(`    Error: ${status.error}`));
      }
    }

    // Watch mode (simple refresh every 3 seconds)
    if (options.watch) {
      console.log(
        colors.gray('\n⏱️  Watching for changes every 3s (Ctrl+C to exit)...')
      );

      const watchInterval = setInterval(async () => {
        // Clear screen and show updated status
        process.stdout.write('\x1b[2J\x1b[0f');
        await listCommand({ ...options, watch: false, watching: true });
        console.log(
          colors.gray('\n⏱️  Refreshing every 3s (Ctrl+C to exit)...')
        );
      }, 3000);

      // Handle Ctrl+C
      process.on('SIGINT', () => {
        clearInterval(watchInterval);
        process.exit(0);
      });
    }

    if (!options.watch && !options.watching) {
      showTips([
        'Use ' +
          colors.cyan('rover list --watch') +
          ' to monitor the task status',
        'Use ' +
          colors.cyan('rover task') +
          ' to assign a new task to an agent',
        'Use ' + colors.cyan('rover inspect <id>') + ' to see the task details',
        'Use ' +
          colors.cyan('rover logs <id> --follow') +
          ' to read the task logs',
      ]);
    }
  } catch (error) {
    console.error(colors.red('Error getting task status:'), error);
  } finally {
    await telemetry?.shutdown();
  }
};
