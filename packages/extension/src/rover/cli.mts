import * as vscode from 'vscode';
import { MergeResult, PushResult, RoverTask, TaskDetails, IterateResult } from './types.js';
import { spawn as spawn_, SpawnOptions } from 'child_process';
import { execa, ExecaError, Options, Result } from 'execa';

export async function spawn(
    command: string,
    args?: ReadonlyArray<string>,
    options?: Options
): Promise<Result> {
    try {
        return await execa(command, args, options);
    } catch (error) {
        if (error instanceof ExecaError) {
            if (error.exitCode !== 0) {
                throw `exit code for ${command} is ${error.exitCode} (stdout: ${error.stdout}; stderr: ${error.stderr})`;
            } else if (error.cause) {
                throw `failed to execute ${command}: ${error.cause}`;
            } else {
                throw `failed to execute ${command}`;
            }
        } else {
            throw `failed to execute ${command}`;
        }
    }
}

export class RoverCLI {
    private roverPath: string;
    private workspaceRoot: vscode.Uri | undefined;

    constructor() {
        // Try to find rover in PATH or use configuration
        this.roverPath = vscode.workspace.getConfiguration('rover').get<string>('cliPath') || 'rover';

        // Get the workspace root folder
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            this.workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
        }
    }

    private getSpawnOptions(): Options {
        return {
            cwd: this.workspaceRoot?.fsPath || process.cwd(),
            env: {
                ...process.env,
                // For now, disable the CLI telemetry as we will add it to the extension
                ROVER_NO_TELEMETRY: 'true'
            }
        };
    }

    /**
     * Get list of all tasks
     */
    async getTasks(): Promise<RoverTask[]> {
        try {
            const { stdout, stderr, exitCode } = await spawn(this.roverPath, ['list', '--json'], this.getSpawnOptions());
            if (exitCode != 0 || !stdout) {
                 throw new Error(`error listing tasks (stdout: ${stdout}; stderr: ${stderr}; exit code: ${exitCode})`)
            }
            return JSON.parse(stdout.toString()) as RoverTask[];
        } catch (error) {
            if (error instanceof Error && error.message.includes('not found')) {
                throw new Error('Rover CLI not found. Please install Rover or configure the path in settings.');
            }
            throw error;
        }
    }

    /**
     * Create a new task
     */
    async createTask(description: string): Promise<RoverTask> {
        const { stdout, stderr, exitCode } = await spawn(this.roverPath, ['task', description, '--yes', '--json'], this.getSpawnOptions());
        if (exitCode != 0 || !stdout) {
            throw new Error(`error creating task (stdout: ${stdout}; stderr: ${stderr}; exit code: ${exitCode})`)
        }
        return JSON.parse(stdout.toString()) as RoverTask;
    }

    /**
     * Push branch
     */
    async pushBranch(taskId: string, commit: string): Promise<PushResult> {
        const { stdout, stderr, exitCode } = await spawn(this.roverPath, ['push', taskId.toString(), '--message', commit, '--json'], this.getSpawnOptions());
        if (exitCode != 0 || !stdout) {
            throw new Error(`error pushing branch (stdout: ${stdout}; stderr: ${stderr}; exit code: ${exitCode})`)
        }
        return JSON.parse(stdout.toString()) as PushResult;
    }

    /**
     * Iterate a task
     */
    async iterate(taskId: string, instructions: string): Promise<IterateResult> {
        const { stdout, stderr, exitCode } = await spawn(this.roverPath, ['iterate', taskId.toString(), instructions, '--json'], this.getSpawnOptions());
        if (exitCode != 0 || !stdout) {
            throw new Error(`error iterating task (stdout: ${stdout}; stderr: ${stderr}; exit code: ${exitCode})`)
        }
        return JSON.parse(stdout.toString()) as IterateResult;
    }

    /**
     * Get detailed information about a task
     */
    async inspectTask(taskId: string): Promise<TaskDetails> {
        const { stdout, stderr, exitCode } = await spawn(this.roverPath, ['inspect', taskId.toString(), '--json'], this.getSpawnOptions());

        if (exitCode != 0 || !stdout) {
            throw new Error(`error inspecting task (stdout: ${stdout}; stderr: ${stderr}; exit code: ${exitCode})`)
        }

        const result = JSON.parse(stdout.toString());

        // Handle error response
        if (result.error) {
            throw new Error(result.error);
        }

        return result as TaskDetails;
    }

    /**
     * Delete a task
     */
    async deleteTask(taskId: string): Promise<void> {
        const { stdout, stderr, exitCode } = await spawn(this.roverPath, ['delete', taskId.toString(), '--force'], this.getSpawnOptions());

        if (exitCode != 0 || !stdout) {
            throw new Error(`error deleting task (stdout: ${stdout}; stderr: ${stderr}; exit code: ${exitCode})`)
        }
    }

    /**
     * Start a shell for a task (opens in terminal)
     */
    startShell(taskId: string): void {
        if (!this.workspaceRoot) {
            throw new Error("invalid workspace root");
        }
        const terminal = vscode.window.createTerminal({
            name: `Rover: ${taskId}`,
            cwd: this.workspaceRoot.fsPath
        });
        terminal.sendText(`${this.roverPath} shell ${taskId}`);
        terminal.show();
    }

    /**
     * Show logs for a task (opens in output channel)
     */
    async showLogs(taskId: string, follow: boolean = false): Promise<vscode.OutputChannel> {
        const outputChannel = vscode.window.createOutputChannel(`Rover Logs: ${taskId}`);
        outputChannel.show();

        const process = spawn_(this.roverPath, ["logs", `${taskId}${follow ? ' --follow' : ''}`], this.getSpawnOptions() as SpawnOptions);

        process.stdout?.on('data', (data) => {
            outputChannel.append(data.toString());
        });

        process.stderr?.on('data', (data) => {
            outputChannel.append(`ERROR: ${data.toString()}`);
        });

        process.on('close', (code) => {
            if (code !== 0) {
                throw new Error("could not show logs");
            }
        });

        return outputChannel;
    }

    /**
     * Get list of changed files in a task
     */
    async getChangedFiles(taskId: string): Promise<string[]> {
        const { stdout, stderr, exitCode } = await spawn(this.roverPath, ['diff', taskId.toString(), '--only-files'], this.getSpawnOptions());
        if (exitCode != 0 || !stdout) {
            throw new Error(`error retrieving list of changed files (stdout: ${stdout}; stderr: ${stderr}; exit code: ${exitCode})`)
        }
        return stdout.toString().trim().split('\n').filter(line => line.length > 0);
    }

    /**
     * Merge a task
     */
    async mergeTask(taskId: string): Promise<MergeResult> {
        const { stdout, stderr, exitCode } = await spawn(this.roverPath, ['merge', taskId.toString(), '--force', '--json'], this.getSpawnOptions());
        if (exitCode != 0 || !stdout) {
            throw new Error(`error merging task (stdout: ${stdout}; stderr: ${stderr}; exit code: ${exitCode})`)
        }
        return JSON.parse(stdout.toString()) as MergeResult;
    }

    /**
     * Get the workspace directory for a task
     */
    async getTaskWorkspacePath(taskId: string): Promise<string> {
        try {
            const taskDetails = await this.inspectTask(taskId);
            if (taskDetails.worktreePath) {
                return taskDetails.worktreePath;
            }

            // Fallback: construct expected path
            const workspaceRoot = this.workspaceRoot || process.cwd();
            return `${workspaceRoot}/.rover/tasks/${taskId}`;
        } catch (error) {
            // Fallback: construct expected path
            const workspaceRoot = this.workspaceRoot || process.cwd();
            return `${workspaceRoot}/.rover/tasks/${taskId}`;
        }
    }

    /**
     * Check if Rover CLI is installed and accessible
     */
    async checkInstallation(): Promise<{ installed: boolean; version?: string; error?: string }> {
        try {
            const { stdout, exitCode } = await spawn(this.roverPath, ['--version'], this.getSpawnOptions());
            if (exitCode !== 0 || !stdout) {
                throw new Error('could not retrieve rover version')
            }
            const version = stdout.toString().trim();
            return { installed: true, version };
        } catch (error) {
            return { installed: false, error: String(error) };
        }
    }

    /**
     * Check if Rover is initialized in the current workspace
     */
    async checkInitialization(): Promise<boolean> {
        if (!this.workspaceRoot) {
            throw new Error("unknown workspace root");
        }

        try {
            // Check if user settings file exists
            const roverUserSettingsPath = vscode.Uri.joinPath(this.workspaceRoot, '.rover', 'settings.json');
            let roverUserSettingsExists = false;
            try {
                const stat = await vscode.workspace.fs.stat(roverUserSettingsPath);
                roverUserSettingsExists = stat.type === vscode.FileType.File;
            } catch (error) {
                roverUserSettingsExists = false;
            }

            // Check if rover.json file exists
            const roverJsonUri = vscode.Uri.joinPath(this.workspaceRoot, 'rover.json');
            let roverJsonExists = false;
            try {
                const stat = await vscode.workspace.fs.stat(roverJsonUri);
                roverJsonExists = stat.type === vscode.FileType.File;
            } catch (error) {
                roverJsonExists = false;
            }

            return roverUserSettingsExists && roverJsonExists;
        } catch (error) {
            throw new Error(`could not check if rover is initialized in the workspace ${this.workspaceRoot}: ${error}`)
        }
    }

    /**
     * Initialize Rover in the current workspace
     */
    async initializeRover(): Promise<{ success: boolean; error?: string }> {
        try {
            const { stdout, stderr } = await spawn(this.roverPath, ['init', '--yes'], this.getSpawnOptions());
            return { success: true };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    }
}
