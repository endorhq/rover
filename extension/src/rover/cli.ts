import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { MergeResult, PushResult, RoverTask, TaskDetails } from './types';

const execAsync = promisify(exec);

export class RoverCLI {
    private roverPath: string;
    private workspaceRoot: string | undefined;

    constructor() {
        // Try to find rover in PATH or use configuration
        this.roverPath = vscode.workspace.getConfiguration('rover').get<string>('cliPath') || 'rover';

        // Get the workspace root folder
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            this.workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        }
    }

    private getExecOptions() {
        return {
            cwd: this.workspaceRoot || process.cwd()
        };
    }

    /**
     * Get list of all tasks
     */
    async getTasks(): Promise<RoverTask[]> {
        try {
            const { stdout } = await execAsync(`${this.roverPath} list --json`, this.getExecOptions());
            return JSON.parse(stdout) as RoverTask[];
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
        const { stdout } = await execAsync(`${this.roverPath} task "${description}" --yes --json`, this.getExecOptions());
        return JSON.parse(stdout) as RoverTask;
    }

    /**
     * Push branch
     */
    async pushBranch(taskId: string, commit: string): Promise<PushResult> {
        const { stdout } = await execAsync(`${this.roverPath} push "${taskId}" --message "${commit}" --json`, this.getExecOptions());
        return JSON.parse(stdout) as PushResult;
    }

    /**
     * Get detailed information about a task
     */
    async inspectTask(taskId: string): Promise<TaskDetails> {
        const { stdout } = await execAsync(`${this.roverPath} inspect ${taskId} --json`, this.getExecOptions());
        const result = JSON.parse(stdout);

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
        await execAsync(`${this.roverPath} delete ${taskId} --force`, this.getExecOptions());
    }

    /**
     * Start a shell for a task (opens in terminal)
     */
    startShell(taskId: string): void {
        const terminal = vscode.window.createTerminal({
            name: `Rover: ${taskId}`,
            cwd: this.workspaceRoot
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

        const command = `${this.roverPath} logs ${taskId}${follow ? ' --follow' : ''}`;

        const process = exec(command, this.getExecOptions());

        process.stdout?.on('data', (data) => {
            outputChannel.append(data.toString());
        });

        process.stderr?.on('data', (data) => {
            outputChannel.append(`ERROR: ${data.toString()}`);
        });

        process.on('close', (code) => {
            if (code !== 0) {
                outputChannel.appendLine(`\nProcess exited with code ${code}`);
            }
        });

        return outputChannel;
    }

    /**
     * Get list of changed files in a task
     */
    async getChangedFiles(taskId: string): Promise<string[]> {
        const { stdout } = await execAsync(`${this.roverPath} diff ${taskId} --only-files`, this.getExecOptions());
        return stdout.trim().split('\n').filter(line => line.length > 0);
    }

    /**
     * Merge a task
     */
    async mergeTask(taskId: string): Promise<MergeResult> {
        const { stdout } = await execAsync(`${this.roverPath} merge ${taskId} --force --json`, this.getExecOptions());
        return JSON.parse(stdout) as MergeResult;
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
}