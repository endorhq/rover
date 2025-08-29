import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskStatus } from '../types.js';

/**
 * Write status update to the status file
 */
export const writeStatus = (outputPath: string, status: Partial<TaskStatus>) => {
    try {
        const statusPath = join(outputPath, 'status.json');
        let currentStatus: TaskStatus;

        // Read existing status or create new one
        if (existsSync(statusPath)) {
            try {
                currentStatus = JSON.parse(readFileSync(statusPath, 'utf8'));
            } catch (error) {
                // If file is corrupted, create new status
                currentStatus = createInitialStatus(status.taskId || 'unknown');
            }
        } else {
            currentStatus = createInitialStatus(status.taskId || 'unknown');
        }

        // Update with new values
        const updatedStatus: TaskStatus = {
            ...currentStatus,
            ...status,
            updatedAt: new Date().toISOString()
        };

        // Set completedAt if status is completed or failed
        if ((status.status === 'completed' || status.status === 'failed') && !updatedStatus.completedAt) {
            updatedStatus.completedAt = new Date().toISOString();
        }

        writeFileSync(statusPath, JSON.stringify(updatedStatus, null, 2));

    } catch (error) {
        console.error('Error writing status file:', error);
    }
};

/**
 * Read status from the status file
 */
export const readStatus = (outputPath: string): TaskStatus | null => {
    try {
        const statusPath = join(outputPath, 'status.json');

        if (!existsSync(statusPath)) {
            return null;
        }

        const statusData = readFileSync(statusPath, 'utf8');
        return JSON.parse(statusData);

    } catch (error) {
        console.error('Error reading status file:', error);
        return null;
    }
};

/**
 * Get all task statuses from the rover tasks directory
 */
export const getAllTaskStatuses = (): { taskId: string; status: TaskStatus | null; taskData?: any }[] => {
    try {
        const roverPath = join(process.cwd(), '.rover');
        const tasksPath = join(roverPath, 'tasks');

        if (!existsSync(tasksPath)) {
            return [];
        }

        const taskIds = readdirSync(tasksPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name)
            .filter(name => !isNaN(parseInt(name, 10))) // Only numeric task IDs
            .sort((a, b) => parseInt(a, 10) - parseInt(b, 10)); // Sort numerically

        return taskIds.map(taskId => {
            const taskPath = join(tasksPath, taskId);
            const iterationsPath = join(taskPath, 'iterations');

            // Find the latest iteration
            let latestStatus: TaskStatus | null = null;
            let taskData: any = null;

            // Read task metadata
            try {
                const descriptionPath = join(taskPath, 'description.json');
                if (existsSync(descriptionPath)) {
                    taskData = JSON.parse(readFileSync(descriptionPath, 'utf8'));
                }
            } catch (error) {
                // Ignore task data read errors
            }

            if (['MERGED', 'PUSHED'].includes(taskData?.status)) {
                latestStatus = taskData.status;
            } else {
                if (existsSync(iterationsPath)) {
                    try {
                        const iterations = readdirSync(iterationsPath, { withFileTypes: true })
                            .filter(dirent => dirent.isDirectory())
                            .map(dirent => parseInt(dirent.name, 10))
                            .filter(num => !isNaN(num))
                            .sort((a, b) => b - a); // Sort descending to get latest first

                        if (iterations.length > 0) {
                            const latestIterationPath = join(iterationsPath, iterations[0].toString());
                            latestStatus = readStatus(latestIterationPath);
                        }
                    } catch (error) {
                        // Ignore iteration read errors
                    }
                }
            }

            return {
                taskId,
                status: latestStatus,
                taskData
            };
        });

    } catch (error) {
        console.error('Error getting all task statuses:', error);
        return [];
    }
};

/**
 * Create initial status object
 */
const createInitialStatus = (taskId: string): TaskStatus => {
    const now = new Date().toISOString();
    return {
        taskId,
        status: 'initializing',
        currentStep: 'Starting task execution',
        startedAt: now,
        updatedAt: now
    };
};

/**
 * Update task description file with status information
 */
export const updateTaskWithStatus = (taskId: string, status: TaskStatus) => {
    try {
        const roverPath = join(process.cwd(), '.rover');
        const taskPath = join(roverPath, 'tasks', taskId);
        const descriptionPath = join(taskPath, 'description.json');

        if (!existsSync(descriptionPath)) {
            return;
        }

        const taskData = JSON.parse(readFileSync(descriptionPath, 'utf8'));

        // Update task data with status information
        taskData.lastStatusUpdate = status.updatedAt;
        if (status.status === 'completed') {
            taskData.status = 'COMPLETED';
            taskData.completedAt = status.completedAt;
        } else if (status.status === 'merged') {
            taskData.status = 'MERGED';
            taskData.mergedAt = status.mergedAt;
        } else if (status.status === 'pushed') {
            taskData.status = 'PUSHED';
            taskData.mergedAt = status.pushedAt;
        } else if (status.status === 'failed') {
            taskData.status = 'FAILED';
            taskData.failedAt = status.completedAt;
            taskData.error = status.error;
        } else if (status.status === 'running') {
            taskData.status = 'IN_PROGRESS';
        }

        writeFileSync(descriptionPath, JSON.stringify(taskData, null, 2));

    } catch (error) {
        console.error('Error updating task with status:', error);
    }
};
