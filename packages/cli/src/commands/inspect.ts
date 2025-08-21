import colors from 'ansi-colors';
import { formatTaskStatus, statusColor } from '../utils/task-status.js';
import { TaskDescription, TaskNotFoundError, type TaskStatus } from '../lib/description.js';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { showTips } from '../utils/display.js';
import { getTelemetry } from '../lib/telemetry.js';

/**
 * Interface for JSON output of task inspection
 */
interface TaskInspectionOutput {
    id: number;
    uuid: string;
    title: string;
    description: string;
    status: TaskStatus;
    formattedStatus: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    failedAt?: string;
    lastIterationAt?: string;
    iterations: number;
    worktreePath: string;
    branchName: string;
    error?: string;
    taskDirectory: string;
    statusUpdated: boolean;
    files?: string[];
}

/**
 * Build the error JSON output with consistent TaskInspectionOutput shape
 */
const jsonErrorOutput = (error: string, taskId?: number, task?: TaskDescription): TaskInspectionOutput => {
    return {
        id: task?.id || taskId || 0,
        uuid: task?.uuid || '',
        title: task?.title || 'Unknown Task',
        description: task?.description || '',
        status: task?.status || 'FAILED',
        formattedStatus: task ? formatTaskStatus(task.status) : 'Failed',
        createdAt: task?.createdAt || new Date().toISOString(),
        startedAt: task?.startedAt,
        completedAt: task?.completedAt,
        failedAt: task?.failedAt,
        lastIterationAt: task?.lastIterationAt,
        iterations: task?.iterations || 0,
        worktreePath: task?.worktreePath || '',
        branchName: task?.branchName || '',
        error: error,
        taskDirectory: `.rover/tasks/${taskId || 0}/`,
        statusUpdated: false,
        files: []
    };
};

/**
 * Discover files in iteration directory with tree structure
 */
const discoverIterationFiles = (taskId: number, iterationId: number): string[] => {
    const iterationDir = join(process.cwd(), '.rover', 'tasks', taskId.toString(), 'iterations', iterationId.toString());

    if (!existsSync(iterationDir)) {
        return [];
    }

    const files: string[] = [];

    const walkDirectory = (dir: string, prefix: string = '') => {
        try {
            const entries = readdirSync(dir, { withFileTypes: true });
            entries.sort((a, b) => {
                // Directories first, then files
                if (a.isDirectory() && !b.isDirectory()) return -1;
                if (!a.isDirectory() && b.isDirectory()) return 1;
                return a.name.localeCompare(b.name);
            });

            entries.forEach((entry) => {
                if (entry.name.endsWith('.md')) {
                    files.push(entry.name);
                }
            });
        } catch (error) {
            // Skip directories that cannot be read
        }
    };

    walkDirectory(iterationDir);
    return files;
};

export const iterationFiles = (taskId: number, iterationNumber: number, files?: string[]) => {
    if (files === undefined) {
        files = ["summary.md"]
    }

    let result = new Map<string, string>();

    const discoveredFiles = discoverIterationFiles(taskId, iterationNumber);
    for (const file of discoveredFiles) {
        if (files.includes(file)) {
            const fileContents = readFileSync(join(process.cwd(), '.rover', 'tasks', taskId.toString(), 'iterations', iterationNumber.toString(), file), 'utf8');
            result.set(file, fileContents)
        }
    }

    return result;
}

export const inspectCommand = async (taskId: string, iterationNumber?: number, options: { json?: boolean, file?: string[] } = {}) => {
    // Convert string taskId to number
    const numericTaskId = parseInt(taskId, 10);

    if (isNaN(numericTaskId)) {
        if (options.json) {
            const errorOutput = jsonErrorOutput(`Invalid task ID '${taskId}' - must be a number`);
            console.log(JSON.stringify(errorOutput, null, 2));
        } else {
            console.log(colors.red(`✗ Invalid task ID '${taskId}' - must be a number`));
            showTips(
                [
                    colors.gray('Run the ') + colors.cyan('rover inspect 1') + colors.gray(' to get the task details')
                ]
            );
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

        if (options.json) {
            // Output JSON format
            const jsonOutput: TaskInspectionOutput = {
                id: task.id,
                uuid: task.uuid,
                title: task.title,
                description: task.description,
                status: task.status,
                formattedStatus: formatTaskStatus(task.status),
                createdAt: task.createdAt,
                startedAt: task.startedAt,
                completedAt: task.completedAt,
                failedAt: task.failedAt,
                lastIterationAt: task.lastIterationAt,
                iterations: task.iterations,
                worktreePath: task.worktreePath,
                branchName: task.branchName,
                error: task.error,
                taskDirectory: `.rover/tasks/${numericTaskId}/`,
                statusUpdated: false, // TODO: Implement status checking in TaskDescription
                files: discoverIterationFiles(numericTaskId, iterationNumber)
            };

            console.log(JSON.stringify(jsonOutput, null, 2));
        } else {
            // Format status with user-friendly names
            const formattedStatus = formatTaskStatus(task.status);

            // Status color
            const statusColorFunc = statusColor(task.status);

            console.log(colors.bold.white('\nTask Details'));
            console.log(`├── ${colors.gray('ID: ')} ${colors.cyan(task.id.toString())} (${colors.gray(task.uuid)})`);
            console.log('├── ' + colors.gray('Title: ') + colors.white(task.title));
            console.log('├── ' + colors.gray('Status: ') + statusColorFunc(formattedStatus));
            console.log('├── ' + colors.gray('Directory: ') + colors.white(`.rover/tasks/${numericTaskId}/`));
            console.log('├── ' + colors.gray('Workspace: ') + colors.white(task.worktreePath));
            console.log('└── ' + colors.gray('Branch: ') + colors.white(task.branchName));

            console.log(colors.bold.white('\nDescription:'));
            console.log(colors.gray(task.description));

            console.log(colors.bold.white('\nTimestamps'));
            console.log('├── ' + colors.gray('Created: ') + colors.white(new Date(task.createdAt).toLocaleString()));

            // Show completion time if completed
            if (task.completedAt) {
                console.log('├── ' + colors.gray('Completed: ') + colors.green(new Date(task.completedAt).toLocaleString()));
            } else {
                console.log('├── ' + colors.gray('Completed: ') + colors.gray('-'));
            }

            if (task.failedAt) {
                console.log('└── ' + colors.gray('Failed: ') + colors.red(new Date(task.failedAt).toLocaleString()));
            } else {
                console.log('└── ' + colors.gray('Failed: ') + colors.gray('-'));
            }

            // Show error if failed
            if (task.error) {
                console.log(colors.red('\nError: '));
                console.log(colors.white(task.error));
            }

            console.log(colors.bold.white("\nIteration Details ") + colors.gray(`${iterationNumber}/${task.iterations}`));

            console.log('└── ' + colors.white('Files:'));
            const discoveredFiles = discoverIterationFiles(numericTaskId, iterationNumber);
            for (const file of discoveredFiles) {
                console.log(colors.white(`     └── ${colors.cyan(file)}`));
            }

            const fileFilter = options.file || ["summary.md"];

            const iterationFileContents = iterationFiles(numericTaskId, iterationNumber, fileFilter);
            if (iterationFileContents.size === 0) {
                console.log(colors.gray(`\nNo content for the ${fileFilter.join(', ')} files found for iteration ${iterationNumber}.`));
            } else {
                console.log(colors.white.bold('\nOutput content:'));
                iterationFileContents.forEach((contents, file) => {
                    console.log(`└── ${colors.cyan(file)}:`);
                    contents.split('\n').forEach((line) => {
                        let chunks = [line];
                        if (line.length > process.stdout.columns) {
                            chunks = line.split(new RegExp("(.{" + (process.stdout.columns - 8).toString() + "})"));
                        }

                        chunks.forEach(chunk => console.log(colors.white('    | ' + chunk)));
                    })
                    console.log();
                });
            }

            const tips = [];

            if (task.iterations > 1) {
                tips.push(
                    'Use ' + colors.cyan(`rover inspect ${taskId} ${task.iterations}`) + ' to check the details of a different iteration'
                );
            }

            if (options.file == null) {
                tips.push(
                    'Use ' + colors.cyan(`rover inspect ${taskId} --file ${discoveredFiles[0]}`) + ' to read its content'
                );
            }

            showTips([
                ...tips,
                'Use ' + colors.cyan(`rover iterate ${taskId}`) + ' to start a new agent iteration on this task'
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
                const errorOutput = jsonErrorOutput(`Error inspecting task: ${error}`, numericTaskId);
                console.log(JSON.stringify(errorOutput, null, 2));
            } else {
                console.error(colors.red('Error inspecting task:'), error);
            }
        }
    }
};
