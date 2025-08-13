import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { getTelemetry } from '../lib/telemetry.js';
import { showRoverChat } from '../utils/display.js';
import { statusColor } from '../utils/task-status.js';

const { prompt } = enquirer;

export const deleteCommand = async (taskId: string) => {
    const telemetry = getTelemetry();
    // Convert string taskId to number
    const numericTaskId = parseInt(taskId, 10);
    if (isNaN(numericTaskId)) {
        console.log(colors.red(`✗ Invalid task ID '${taskId}' - must be a number`));
        return;
    }

    try {
        showRoverChat([
            "It's time to cleanup some tasks!"
        ])

        // Load task using TaskDescription
        const task = TaskDescription.load(numericTaskId);
        const taskPath = join(process.cwd(), '.rover', 'tasks', numericTaskId.toString());

        const colorFunc = statusColor(task.status);

        console.log(colors.white.bold('Task to delete'));
        console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
        console.log(colors.gray('├── Title: ') + colors.white(task.title));
        console.log(colors.gray('└── Status: ') + colorFunc(task.status) + '\n');

        // Confirm deletion
        const { confirm } = await prompt<{ confirm: boolean }>({
            type: 'confirm',
            name: 'confirm',
            message: 'Are you sure you want to delete this task?',
            initial: false
        });

        if (confirm) {
            // Create backup before deletion
            task.delete();
            rmSync(taskPath, { recursive: true, force: true });
            telemetry?.eventDeleteTask();
            console.log(colors.green('\n✓ Task deleted successfully!'));
        } else {
            console.log(colors.yellow('\n⚠ Task deletion cancelled'));
        }

    } catch (error) {
        if (error instanceof TaskNotFoundError) {
            console.log(colors.red(`✗ ${error.message}`));
        } else {
            console.error(colors.red('Error deleting task'), error);
        }
    } finally {
        await telemetry?.shutdown();
    }
};