import colors from 'ansi-colors';
import { getAllTaskStatuses, updateTaskWithStatus } from '../utils/status.js';

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
 * Format status with colors
 */
const formatStatus = (status: string): string => {
    switch (status) {
        case 'initializing':
            return colors.cyan(status.toUpperCase());
        case 'installing':
            return colors.yellow(status.toUpperCase());
        case 'running':
            return colors.blue(status.toUpperCase());
        case 'completed':
            return colors.green(status.toUpperCase());
        case 'failed':
            return colors.red(status.toUpperCase());
        default:
            return colors.gray(status.toUpperCase());
    }
};

/**
 * Format progress bar
 */
const formatProgress = (progress?: number): string => {
    if (progress === undefined) return colors.gray('─────');
    
    const barLength = 8;
    const filled = Math.round((progress / 100) * barLength);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
    
    if (progress === 100) {
        return colors.green(bar);
    } else if (progress >= 75) {
        return colors.cyan(bar);
    } else if (progress >= 50) {
        return colors.yellow(bar);
    } else {
        return colors.red(bar);
    }
};

/**
 * Truncate text to fit column width
 */
const truncateText = (text: string, maxLength: number): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
};

export const listCommand = async (options: { watch?: boolean; verbose?: boolean } = {}) => {
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
            console.log(colors.yellow('📋 No tasks found'));
            console.log(colors.gray('   Use ') + colors.white('rover task') + colors.gray(' to create and start a task'));
            return;
        }
        
        // Update task metadata with latest status information
        for (const { taskId, status } of activeStatuses) {
            if (status) {
                updateTaskWithStatus(taskId, status);
            }
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
            
            let row = '';
            row += colors.cyan(taskId.padEnd(columnWidths[0]));
            row += colors.white(truncateText(title, columnWidths[1] - 1).padEnd(columnWidths[1]));
            row += formatStatus(status.status).padEnd(columnWidths[2] + 10); // +10 for ANSI codes
            row += formatProgress(status.progress).padEnd(columnWidths[3] + 10);
            row += colors.gray(truncateText(status.currentStep, columnWidths[4] - 1).padEnd(columnWidths[4]));
            row += colors.gray(duration);
            
            console.log(row);
            
            // Show error in verbose mode
            if (options.verbose && status.error) {
                console.log(colors.red(`    Error: ${status.error}`));
            }
        }
        
        console.log('');
        
        // Show summary
        const runningCount = activeStatuses.filter(({ status }) => 
            status?.status === 'running' || status?.status === 'initializing' || status?.status === 'installing'
        ).length;
        
        const completedCount = activeStatuses.filter(({ status }) => 
            status?.status === 'completed'
        ).length;
        
        const failedCount = activeStatuses.filter(({ status }) => 
            status?.status === 'failed'
        ).length;
        
        let summary = '';
        if (runningCount > 0) summary += colors.blue(`${runningCount} running`);
        if (completedCount > 0) {
            if (summary) summary += ', ';
            summary += colors.green(`${completedCount} completed`);
        }
        if (failedCount > 0) {
            if (summary) summary += ', ';
            summary += colors.red(`${failedCount} failed`);
        }
        
        console.log(colors.gray('Summary: ') + summary);
        
        // Show tips
        console.log('');
        console.log(colors.gray('Tips:'));
        console.log(colors.gray('  Use ') + colors.cyan('rover list --verbose') + colors.gray(' to see error details'));
        console.log(colors.gray('  Use ') + colors.cyan('rover task <id> --follow') + colors.gray(' to follow logs'));
        console.log(colors.gray('  Use ') + colors.cyan('rover diff <id>') + colors.gray(' to see changes'));
        
        // Watch mode (simple refresh every 5 seconds)
        if (options.watch) {
            console.log(colors.gray('⏱️  Watching for changes (Ctrl+C to exit)...'));
            
            const watchInterval = setInterval(async () => {
                // Clear screen and show updated status
                process.stdout.write('\x1b[2J\x1b[0f');
                await listCommand({ ...options, watch: false });
                console.log(colors.gray('⏱️  Refreshing every 5s (Ctrl+C to exit)...'));
            }, 5000);
            
            // Handle Ctrl+C
            process.on('SIGINT', () => {
                clearInterval(watchInterval);
                console.log(colors.yellow('\n\n⚠ Watch mode stopped'));
                process.exit(0);
            });
        }
        
    } catch (error) {
        console.error(colors.red('Error getting task status:'), error);
    }
};