import colors from 'ansi-colors';
import { getAllTaskStatuses, updateTaskWithStatus } from '../utils/status.js';
import { formatTaskStatus, statusColor } from '../utils/task-status.js';
import { roverBanner } from '../utils/banner.js';
import showTips from '../utils/tips.js';

/**
 * Format duration from start to now or completion
 */
const formatDuration = (startTime: string, endTime?: string): string => {
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
    } else if (step === 'completed') {
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

export const listCommand = async (options: { watch?: boolean; verbose?: boolean; json?: boolean, watching?: boolean } = {}) => {
    try {
        const allStatuses = getAllTaskStatuses();

        // Filter out tasks without active status or recent activity
        const activeStatuses = allStatuses.filter(({ status, taskData }) => {
            if (!status) return false;

            // Show running, recent completed/failed tasks, or tasks with containers
            if (status.status === 'running' || status.status === 'initializing' || status.status === 'installing' || status.status === 'completed' || status.status === 'failed') {
                return true;
            }

            return false;
        });

        if (activeStatuses.length === 0) {
            if (options.json) {
                console.log(JSON.stringify([]));
            } else {
                console.log(colors.yellow('📋 No tasks found'));

                showTips([
                    'Use ' + colors.cyan('rover task') + ' to assign a new task to an agent'
                ]);
            }
            return;
        }

        // Update task metadata with latest status information
        for (const { taskId, status } of activeStatuses) {
            if (status) {
                updateTaskWithStatus(taskId, status);
            }
        }

        // JSON output mode
        if (options.json) {
            const jsonOutput = activeStatuses.map(({ taskId, status, taskData }) => ({
                id: taskId,
                title: taskData?.title || 'Unknown Task',
                status: status?.status || 'unknown',
                progress: status?.progress,
                currentStep: status?.currentStep || '',
                startedAt: status?.startedAt,
                completedAt: status?.completedAt,
                error: status?.error
            }));
            console.log(JSON.stringify(jsonOutput, null, 2));
            return;
        }

        // Table headers
        const headers = ['ID', 'Title', 'Status', 'Progress', 'Current Step', 'Duration'];
        const columnWidths = [4, 35, 12, 10, 30, 10];

        // Print header
        let headerRow = '';
        headers.forEach((header, index) => {
            headerRow += colors.bold(colors.white(header.padEnd(columnWidths[index])));
        });
        console.log(headerRow);

        // Print separator
        let separatorRow = '';
        columnWidths.forEach(width => {
            separatorRow += '─'.repeat(width);
        });
        console.log(colors.gray(separatorRow));

        // Print rows
        for (const { taskId, status, taskData } of activeStatuses) {
            if (!status) continue;

            const title = taskData?.title || 'Unknown Task';
            const duration = formatDuration(status.startedAt, status.completedAt);
            const colorFunc = statusColor(status.status);

            let row = '';
            row += colors.cyan(taskId.padEnd(columnWidths[0]));
            row += colors.white(truncateText(title, columnWidths[1] - 1).padEnd(columnWidths[1]));
            row += colorFunc(formatTaskStatus(status.status).padEnd(columnWidths[2])); // +10 for ANSI codes
            row += formatProgress(status.status, status.progress).padEnd(columnWidths[3] + 10);
            row += colors.gray(truncateText(status.currentStep, columnWidths[4] - 1).padEnd(columnWidths[4]));
            row += colors.gray(duration);

            console.log(row);

            // Show error in verbose mode
            if (options.verbose && status.error) {
                console.log(colors.red(`    Error: ${status.error}`));
            }
        }

        // Watch mode (simple refresh every 3 seconds)
        if (options.watch) {
            console.log(colors.gray('\n⏱️  Watching for changes every 3s (Ctrl+C to exit)...'));

            const watchInterval = setInterval(async () => {
                // Clear screen and show updated status
                process.stdout.write('\x1b[2J\x1b[0f');
                await listCommand({ ...options, watch: false, watching: true });
                console.log(colors.gray('\n⏱️  Refreshing every 3s (Ctrl+C to exit)...'));
            }, 3000);

            // Handle Ctrl+C
            process.on('SIGINT', () => {
                clearInterval(watchInterval);
                process.exit(0);
            });
        }

        if (!options.watch && !options.watching) {
            showTips([
                'Use ' + colors.cyan('rover list --watch') + ' to monitor the task status',
                'Use ' + colors.cyan('rover task') + ' to assign a new task to an agent',
                'Use ' + colors.cyan('rover inspect <id>') + ' to see the task details',
                'Use ' + colors.cyan('rover logs <id> --follow') + ' to read the task logs'
            ]);
        }

    } catch (error) {
        console.error(colors.red('Error getting task status:'), error);
    }
};
