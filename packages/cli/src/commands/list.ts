import colors from 'ansi-colors';
import { formatTaskStatus, statusColor } from '../utils/task-status.js';
import { showTips } from '../utils/display.js';
import { getTelemetry } from '../lib/telemetry.js';
import { getDescriptions, TaskDescriptionSchema } from '../lib/description.js';
import { VERBOSE } from 'rover-common';
import {
  getLastTaskIteration,
  getTaskIterations,
  IterationConfig,
} from '../lib/iteration.js';

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
    const tasks = getDescriptions();

    if (!options.watching) {
      telemetry?.eventListTasks();
    }

    if (tasks.length === 0) {
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

    // Update task status
    tasks.forEach(task => {
      try {
        task.updateStatus();
      } catch (err) {
        if (!options.json) {
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
    if (options.json) {
      const jsonOutput: Array<
        TaskDescriptionSchema & { iterationsData: IterationConfig[] }
      > = [];

      tasks.forEach(task => {
        let iterationsData: IterationConfig[] = [];
        try {
          iterationsData = getTaskIterations(task);
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

    // Table headers
    const headers = [
      'ID',
      'Title',
      'Agent',
      'Status',
      'Progress',
      'Current Step',
      'Duration',
    ];
    const columnWidths = [4, 30, 8, 12, 10, 25, 10];

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

    // Print rows
    for (const task of tasks) {
      const lastIteration = getLastTaskIteration(task);
      const title = task.title || 'Unknown Task';
      const taskStatus = task.status;
      const startedAt = task.startedAt;

      // Determine end time based on task status
      let endTime: string | undefined;
      if (taskStatus === 'FAILED') {
        endTime = task.failedAt;
      } else if (['COMPLETED', 'MERGED', 'PUSHED'].includes(taskStatus)) {
        endTime = task.completedAt;
      }

      const duration = formatDuration(startedAt, endTime);
      const colorFunc = statusColor(taskStatus);

      const agent = task.agent || '-';

      let row = '';
      row += colors.cyan(task.id.toString().padEnd(columnWidths[0]));
      row += colors.white(
        truncateText(title, columnWidths[1] - 1).padEnd(columnWidths[1])
      );
      row += colors.gray(agent.padEnd(columnWidths[2]));
      row += colorFunc(formatTaskStatus(taskStatus).padEnd(columnWidths[3])); // +10 for ANSI codes
      row += formatProgress(
        taskStatus,
        lastIteration?.status()?.progress || 0
      ).padEnd(columnWidths[4] + 10);
      row += colors.gray(
        truncateText(
          lastIteration?.status()?.currentStep || '-',
          columnWidths[5] - 1
        ).padEnd(columnWidths[5])
      );
      row += colors.gray(lastIteration?.status() ? duration : '-');
      console.log(row);

      // Show error in verbose mode
      if (options.verbose && task.error) {
        console.log(colors.red(`    Error: ${task.error}`));
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
