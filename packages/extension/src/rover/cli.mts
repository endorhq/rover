import * as vscode from 'vscode';
import {
  MergeResult,
  PushResult,
  RoverTask,
  TaskDetails,
  IterateResult,
} from './types.js';
import { findProjectRoot, launch, type Options } from 'rover-common';

// TODO: Load workflows dynamically after we allow users to define their own workflows
const ROVER_DEFAULT_WORKFLOWS = [
  { id: 'swe', label: 'swe - Software Engineer for coding tasks' },
];

export class RoverCLI {
  private roverPath: string;
  private workspaceRoot: vscode.Uri | undefined;

  constructor() {
    // Try to find rover in PATH or use configuration
    this.roverPath =
      vscode.workspace.getConfiguration('rover').get<string>('cliPath') ||
      'rover';

    // Get the workspace root folder
    if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      this.workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
    }
  }

  private getLaunchOptions(): Options {
    return {
      cwd: this.workspaceRoot?.fsPath || findProjectRoot(),
      env: {
        ...process.env,
        // For now, disable the CLI telemetry as we will add it to the extension
        ROVER_NO_TELEMETRY: 'true',
      },
    };
  }

  /**
   * Get git branches for the repository
   */
  async getGitBranches(): Promise<{
    branches: string[];
    defaultBranch: string;
  }> {
    try {
      const options = this.getLaunchOptions();

      // Get default branch (usually main or master)
      let defaultBranch = 'main';
      try {
        const { stdout: defaultBranchOutput } = await launch(
          'git',
          ['symbolic-ref', 'refs/remotes/origin/HEAD'],
          options
        );

        if (defaultBranchOutput) {
          // Extract branch name from refs/remotes/origin/main
          const match = defaultBranchOutput
            .toString()
            .match(/refs\/remotes\/origin\/(.+)/);
          if (match) {
            defaultBranch = match[1].trim();
          }
        }
      } catch (error) {
        // If can't get default branch, try to get current branch
        try {
          const { stdout: currentBranchOutput } = await launch(
            'git',
            ['branch', '--show-current'],
            options
          );
          if (currentBranchOutput) {
            defaultBranch = currentBranchOutput.toString().trim();
          }
        } catch (currentError) {
          // Keep default as 'main'
        }
      }

      // Get all local branches
      const { stdout: branchesOutput } = await launch(
        'git',
        ['branch', '--format=%(refname:short)'],
        options
      );

      let branches: string[] = [];
      if (branchesOutput) {
        branches = branchesOutput
          .toString()
          .split('\n')
          .map(b => b.trim())
          .filter(b => b && !b.startsWith('rover/')) // Filter out rover branches
          .sort();
      }

      // Ensure default branch is in the list
      if (!branches.includes(defaultBranch)) {
        branches.unshift(defaultBranch);
      }

      return { branches, defaultBranch };
    } catch (error) {
      console.error('Failed to get git branches:', error);
      // Return sensible defaults if git commands fail
      return { branches: ['main'], defaultBranch: 'main' };
    }
  }

  /**
   * Get user settings including available agents
   */
  async getSettings(): Promise<{
    aiAgents: string[];
    defaultAgent: string;
    workflows: Array<{ id: string; label: string }>;
  }> {
    try {
      // Read the settings file directly from .rover/settings.json
      const settingsPath = vscode.Uri.joinPath(
        this.workspaceRoot || vscode.Uri.file(findProjectRoot()),
        '.rover',
        'settings.json'
      );

      try {
        const settingsContent =
          await vscode.workspace.fs.readFile(settingsPath);
        const settings = JSON.parse(new TextDecoder().decode(settingsContent));

        return {
          aiAgents: settings.aiAgents || ['claude'],
          defaultAgent: settings.defaults?.aiAgent || 'claude',
          workflows: ROVER_DEFAULT_WORKFLOWS,
        };
      } catch (error) {
        // If file doesn't exist or can't be read, return defaults
        console.error('Failed to load settings:', error);
        return {
          aiAgents: ['claude'],
          defaultAgent: 'claude',
          workflows: ROVER_DEFAULT_WORKFLOWS,
        };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      return {
        aiAgents: ['claude'],
        defaultAgent: 'claude',
        workflows: ROVER_DEFAULT_WORKFLOWS,
      };
    }
  }

  /**
   * Get list of all tasks
   */
  async getTasks(): Promise<RoverTask[]> {
    try {
      const { stdout, stderr, exitCode } = await launch(
        this.roverPath,
        ['list', '--json'],
        this.getLaunchOptions()
      );
      if (exitCode != 0 || !stdout) {
        throw new Error(
          `error listing tasks (stdout: ${stdout}; stderr: ${stderr}; exit code: ${exitCode})`
        );
      }
      return JSON.parse(stdout.toString()) as RoverTask[];
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        throw new Error(
          'Rover CLI not found. Please install Rover or configure the path in settings.'
        );
      }
      throw error;
    }
  }

  /**
   * Create a new task
   */
  async createTask(
    description: string,
    agent?: string,
    sourceBranch?: string,
    workflow?: string
  ): Promise<RoverTask> {
    const args = ['task', '--yes', '--json'];

    // Add agent option if provided
    if (agent && agent.length > 0) {
      args.push('--agent', agent);
    }

    // Add source branch option if provided
    if (sourceBranch && sourceBranch.length > 0) {
      args.push('--source-branch', sourceBranch);
    }

    // Add workflow option if provided
    if (workflow && workflow.length > 0) {
      args.push('--workflow', workflow);
    }

    args.push(description);

    const { stdout, stderr, exitCode } = await launch(
      this.roverPath,
      args,
      this.getLaunchOptions()
    );
    if (exitCode != 0 || !stdout) {
      throw new Error(
        `error creating task (stdout: ${stdout}; stderr: ${stderr}; exit code: ${exitCode})`
      );
    }
    return JSON.parse(stdout.toString()) as RoverTask;
  }

  /**
   * Push branch
   */
  async pushBranch(taskId: string, commit: string): Promise<PushResult> {
    const { stdout, stderr, exitCode } = await launch(
      this.roverPath,
      ['push', taskId.toString(), '--message', commit, '--json'],
      this.getLaunchOptions()
    );
    if (exitCode != 0 || !stdout) {
      throw new Error(
        `error pushing branch (stdout: ${stdout}; stderr: ${stderr}; exit code: ${exitCode})`
      );
    }
    return JSON.parse(stdout.toString()) as PushResult;
  }

  /**
   * Iterate a task
   */
  async iterate(taskId: string, instructions: string): Promise<IterateResult> {
    const { stdout, stderr, exitCode } = await launch(
      this.roverPath,
      ['iterate', taskId.toString(), instructions, '--json'],
      this.getLaunchOptions()
    );
    if (exitCode != 0 || !stdout) {
      throw new Error(
        `error iterating task (stdout: ${stdout}; stderr: ${stderr}; exit code: ${exitCode})`
      );
    }
    return JSON.parse(stdout.toString()) as IterateResult;
  }

  /**
   * Get detailed information about a task
   */
  async inspectTask(taskId: string): Promise<TaskDetails> {
    const { stdout, stderr, exitCode } = await launch(
      this.roverPath,
      ['inspect', taskId.toString(), '--json'],
      this.getLaunchOptions()
    );

    if (exitCode != 0 || !stdout) {
      throw new Error(
        `error inspecting task (stdout: ${stdout}; stderr: ${stderr}; exit code: ${exitCode})`
      );
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
    const { stdout, stderr, exitCode } = await launch(
      this.roverPath,
      ['delete', taskId.toString(), '--yes'],
      this.getLaunchOptions()
    );

    if (exitCode != 0 || !stdout) {
      throw new Error(
        `error deleting task (stdout: ${stdout}; stderr: ${stderr}; exit code: ${exitCode})`
      );
    }
  }

  /**
   * Start a shell for a task (opens in terminal)
   */
  startShell(taskId: string): void {
    if (!this.workspaceRoot) {
      throw new Error('invalid workspace root');
    }
    const terminal = vscode.window.createTerminal({
      name: `Rover: ${taskId}`,
      cwd: this.workspaceRoot.fsPath,
    });
    terminal.sendText(`${this.roverPath} shell ${taskId}`);
    terminal.show();
  }

  /**
   * Show logs for a task (opens in output channel)
   */
  async showLogs(
    taskId: string,
    follow: boolean = false
  ): Promise<vscode.OutputChannel> {
    const outputChannel = vscode.window.createOutputChannel(
      `Rover Logs: ${taskId}`
    );
    outputChannel.show();

    try {
      const { stdout, stderr, exitCode } = await launch(
        this.roverPath,
        ['logs', `${taskId}${follow ? ' --follow' : ''}`],
        this.getLaunchOptions()
      );

      if (stdout) {
        outputChannel.append(stdout.toString());
      }

      if (stderr) {
        outputChannel.append(`ERROR: ${stderr.toString()}`);
      }

      if (exitCode !== 0) {
        throw new Error('could not show logs');
      }
    } catch (error) {
      outputChannel.append(`Error: ${error}`);
    }

    return outputChannel;
  }

  /**
   * Get list of changed files in a task
   */
  async getChangedFiles(taskId: string): Promise<string[]> {
    const { stdout, stderr, exitCode } = await launch(
      this.roverPath,
      ['diff', taskId.toString(), '--only-files'],
      this.getLaunchOptions()
    );
    if (exitCode != 0 || !stdout) {
      throw new Error(
        `error retrieving list of changed files (stdout: ${stdout}; stderr: ${stderr}; exit code: ${exitCode})`
      );
    }
    return stdout
      .toString()
      .trim()
      .split('\n')
      .filter(line => line.length > 0);
  }

  /**
   * Merge a task
   */
  async mergeTask(taskId: string): Promise<MergeResult> {
    const { stdout, stderr, exitCode } = await launch(
      this.roverPath,
      ['merge', taskId.toString(), '--force', '--json'],
      this.getLaunchOptions()
    );
    if (exitCode != 0 || !stdout) {
      throw new Error(
        `error merging task (stdout: ${stdout}; stderr: ${stderr}; exit code: ${exitCode})`
      );
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
      const workspaceRoot = this.workspaceRoot || findProjectRoot();
      return `${workspaceRoot}/.rover/tasks/${taskId}/workspace`;
    } catch (error) {
      // Fallback: construct expected path
      const workspaceRoot = this.workspaceRoot || findProjectRoot();
      return `${workspaceRoot}/.rover/tasks/${taskId}/workspace`;
    }
  }

  /**
   * Check if Rover CLI is installed and accessible
   */
  async checkInstallation(): Promise<{
    installed: boolean;
    version?: string;
    error?: string;
  }> {
    try {
      const { stdout, exitCode } = await launch(
        this.roverPath,
        ['--version'],
        this.getLaunchOptions()
      );
      if (exitCode !== 0 || !stdout) {
        throw new Error('could not retrieve rover version');
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
      return false;
    }

    try {
      // Check if user settings file exists
      const roverUserSettingsPath = vscode.Uri.joinPath(
        this.workspaceRoot,
        '.rover',
        'settings.json'
      );
      let roverUserSettingsExists = false;
      try {
        const stat = await vscode.workspace.fs.stat(roverUserSettingsPath);
        roverUserSettingsExists = stat.type === vscode.FileType.File;
      } catch (error) {
        roverUserSettingsExists = false;
      }

      // Check if rover.json file exists
      const roverJsonUri = vscode.Uri.joinPath(
        this.workspaceRoot,
        'rover.json'
      );
      let roverJsonExists = false;
      try {
        const stat = await vscode.workspace.fs.stat(roverJsonUri);
        roverJsonExists = stat.type === vscode.FileType.File;
      } catch (error) {
        roverJsonExists = false;
      }

      return roverUserSettingsExists && roverJsonExists;
    } catch (error) {
      throw new Error(
        `could not check if rover is initialized in the workspace ${this.workspaceRoot}: ${error}`
      );
    }
  }

  /**
   * Initialize Rover in the current workspace
   */
  async initializeRover(): Promise<{ success: boolean; error?: string }> {
    try {
      const { stdout, stderr } = await launch(
        this.roverPath,
        ['init', '--yes'],
        this.getLaunchOptions()
      );
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}
