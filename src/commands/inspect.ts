import colors from 'ansi-colors';
import { formatTaskStatus } from '../utils/task-status.js';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

interface FileInfo {
    path: string;
    name: string;
    size: number;
}

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

            entries.forEach((entry, index) => {
                const isLast = index === entries.length - 1;
                const connector = isLast ? '└── ' : '├── ';
                const newPrefix = prefix + (isLast ? '    ' : '│   ');

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

export const inspectCommand = (taskId: string, iterationNumber?: number, options: { json?: boolean, file?: string[] } = {}) => {
    // Convert string taskId to number
    const numericTaskId = parseInt(taskId, 10);
    if (isNaN(numericTaskId)) {
        if (options.json) {
            console.log(JSON.stringify({ error: `Invalid task ID '${taskId}' - must be a number` }, null, 2));
        } else {
            console.log(colors.red(`✗ Invalid task ID '${taskId}' - must be a number`));
        }
        return;
    }

    try {
        // Load task using TaskDescription
        const task = TaskDescription.load(numericTaskId);

        if (iterationNumber === undefined) {
            iterationNumber = task.iterations;
        }

        if (options.json) {
            // Output JSON format
            const jsonOutput: any = {
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
                statusUpdated: false // TODO: Implement status checking in TaskDescription
            };


            const discoveredFiles = discoverIterationFiles(numericTaskId, iterationNumber);
            jsonOutput.files = discoverIterationFiles(numericTaskId, iterationNumber);

            console.log(JSON.stringify(jsonOutput, null, 2));
        } else {
            // Format status with user-friendly names
            const formattedStatus = formatTaskStatus(task.status);

            // Status color
            const statusColor = task.status === 'NEW' ? colors.cyan :
                               task.status === 'IN_PROGRESS' ? colors.yellow :
                               task.status === 'ITERATING' ? colors.magenta :
                               task.status === 'COMPLETED' ? colors.green :
                               task.status === 'FAILED' ? colors.red : colors.gray;

            console.log(colors.bold('\n🔍 Task Details\n'));
            console.log(colors.gray('ID: ') + colors.cyan(task.id.toString()));
            console.log(colors.gray('UUID: ') + colors.gray(task.uuid));
            console.log(colors.gray('Title: ') + colors.white(task.title));
            console.log(colors.gray('Status: ') + statusColor(formattedStatus));
            console.log(colors.gray('Created: ') + colors.white(new Date(task.createdAt).toLocaleString()));

            // Show start time if started
            if (task.startedAt) {
                console.log(colors.gray('Started: ') + colors.white(new Date(task.startedAt).toLocaleString()));
            }

            // Show completion time if completed
            if (task.completedAt) {
                console.log(colors.gray('Completed: ') + colors.green(new Date(task.completedAt).toLocaleString()));
            } else if (task.failedAt) {
                console.log(colors.gray('Failed: ') + colors.red(new Date(task.failedAt).toLocaleString()));
            }

            // Show iterations
            console.log(colors.gray('Iterations: ') + colors.cyan(task.iterations.toString()));

            // Show iteration information
            console.log(colors.bold('\n🔄 Iteration'));
            console.log(colors.gray('Iteration #: ') + colors.cyan(iterationNumber.toString()));

            // Show workspace info if available
            if (task.worktreePath) {
                console.log(colors.gray('\nWorkspace: ') + colors.cyan(task.worktreePath));
                console.log(colors.gray('Branch: ') + colors.cyan(task.branchName));
            }

            // Show error if failed
            if (task.error) {
                console.log(colors.gray('\nError: ') + colors.red(task.error));
            }

            console.log(colors.gray('\nDescription:'));
            console.log(colors.white(task.description));

            // Show task directory path
            console.log(colors.gray(`\nTask directory: .rover/tasks/${numericTaskId}/`));
            console.log();

            console.log(colors.gray('\Iteration files:'));
            const discoveredFiles = discoverIterationFiles(numericTaskId, iterationNumber);
            for (const file of discoveredFiles){
                console.log(colors.gray(`  - ${file}`));
            }
            console.log();

            const fileFilter = options.file || ["summary.md"];

            const iterationFileContents = iterationFiles(numericTaskId, iterationNumber, fileFilter);
            if (iterationFileContents.size === 0) {
                console.log(colors.gray(`\nNo output files found for iteration ${iterationNumber}.`));
            } else {
                console.log(colors.gray(`Output files for iteration ${iterationNumber}:`));
                iterationFileContents.forEach((contents, file) => {
                    console.log(`  - File '${file}' contents:`);
                    contents.split('\n').forEach((line) => console.log(colors.cyan('    > ' + line)))
                    console.log();
                });
            }
        }

    } catch (error) {
        if (error instanceof TaskNotFoundError) {
            if (options.json) {
                console.log(JSON.stringify({ error: error.message }, null, 2));
            } else {
                console.log(colors.red(`✗ ${error.message}`));
            }
        } else {
            if (options.json) {
                console.log(JSON.stringify({ error: `Error inspecting task: ${error}` }, null, 2));
            } else {
                console.error(colors.red('Error inspecting task:'), error);
            }
        }
    }
};
