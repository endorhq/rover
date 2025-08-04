import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readStatus } from './status.js';

/**
 * Format task status for user-friendly display
 */
export const formatTaskStatus = (status: string): string => {
    switch (status.toUpperCase()) {
        case 'NEW':
            return 'New';
        case 'IN_PROGRESS':
            return 'In Progress';
        case 'COMPLETED':
            return 'Completed';
        case 'FAILED':
            return 'Failed';
        case 'CANCELLED':
            return 'Cancelled';
        default:
            return status;
    }
};

/**
 * Get the latest iteration status for a task
 */
const getLatestIterationStatus = (taskId: string): { status: string; completedAt?: string } | null => {
    try {
        const roverPath = join(process.cwd(), '.rover');
        const taskPath = join(roverPath, 'tasks', taskId);
        const iterationsPath = join(taskPath, 'iterations');

        if (!existsSync(iterationsPath)) {
            return null;
        }

        // Find the latest iteration
        const iterations = readdirSync(iterationsPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => parseInt(dirent.name, 10))
            .filter(num => !isNaN(num))
            .sort((a, b) => b - a); // Sort descending to get latest first

        if (iterations.length === 0) {
            return null;
        }

        const latestIteration = iterations[0];
        const latestIterationPath = join(iterationsPath, latestIteration.toString());
        const iterationStatus = readStatus(latestIterationPath);

        if (!iterationStatus) {
            return null;
        }

        // Map iteration status to task status
        let taskStatus: string;
        switch (iterationStatus.status) {
            case 'completed':
                taskStatus = 'COMPLETED';
                break;
            case 'failed':
                taskStatus = 'FAILED';
                break;
            case 'running':
            case 'installing':
            case 'initializing':
                taskStatus = 'IN_PROGRESS';
                break;
            default:
                taskStatus = 'IN_PROGRESS';
        }

        return {
            status: taskStatus,
            completedAt: iterationStatus.completedAt
        };

    } catch (error) {
        console.error('Error getting latest iteration status:', error);
        return null;
    }
};

/**
 * Check and update task status based on latest iteration status
 * Returns true if the task status was updated
 */
export const checkAndUpdateTaskStatus = (taskId: string): boolean => {
    try {
        const roverPath = join(process.cwd(), '.rover');
        const taskPath = join(roverPath, 'tasks', taskId);
        const descriptionPath = join(taskPath, 'description.json');

        if (!existsSync(descriptionPath)) {
            return false;
        }

        const taskData = JSON.parse(readFileSync(descriptionPath, 'utf8'));

        // Only check IN_PROGRESS tasks
        if (taskData.status !== 'IN_PROGRESS') {
            return false;
        }

        const iterationStatus = getLatestIterationStatus(taskId);
        if (!iterationStatus) {
            return false;
        }

        // Update task status if it has changed
        if (taskData.status !== iterationStatus.status) {
            taskData.status = iterationStatus.status;

            // Add completion timestamp if completed
            if (iterationStatus.status === 'COMPLETED' && iterationStatus.completedAt) {
                taskData.completedAt = iterationStatus.completedAt;
            } else if (iterationStatus.status === 'FAILED' && iterationStatus.completedAt) {
                taskData.failedAt = iterationStatus.completedAt;
            }

            // Update last checked timestamp
            taskData.lastStatusCheck = new Date().toISOString();

            // Save updated task data
            writeFileSync(descriptionPath, JSON.stringify(taskData, null, 2));

            return true;
        }

        return false;

    } catch (error) {
        console.error(`Error checking task status for task ${taskId}:`, error);
        return false;
    }
};

/**
 * Check and update status for all IN_PROGRESS tasks
 * Returns array of updated task IDs
 */
export const checkAndUpdateAllTaskStatuses = (): string[] => {
    try {
        const roverPath = join(process.cwd(), '.rover');
        const tasksPath = join(roverPath, 'tasks');

        if (!existsSync(tasksPath)) {
            return [];
        }

        const taskIds = readdirSync(tasksPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name)
            .filter(name => !isNaN(parseInt(name, 10))); // Only numeric task IDs

        const updatedTasks: string[] = [];

        for (const taskId of taskIds) {
            if (checkAndUpdateTaskStatus(taskId)) {
                updatedTasks.push(taskId);
            }
        }

        return updatedTasks;

    } catch (error) {
        console.error('Error checking all task statuses:', error);
        return [];
    }
};
