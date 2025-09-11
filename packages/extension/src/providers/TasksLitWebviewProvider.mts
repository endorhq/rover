import * as vscode from 'vscode';
import { RoverCLI } from '../rover/cli.mjs';
import { FileSystemHelper } from '../rover/fileSystem.js';
import { launch } from 'rover-common';

export class TasksLitWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'roverTasks';

  private _view?: vscode.WebviewView;
  private cli: RoverCLI;
  private fileSystem: FileSystemHelper;
  private autoRefreshInterval: NodeJS.Timeout | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.cli = new RoverCLI();
    this.fileSystem = new FileSystemHelper();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'src'),
      ],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async data => {
      switch (data.command) {
        case 'createTask':
          await this.handleCreateTask(data.description, data.agent, data.sourceBranch);
          break;
        case 'refreshTasks':
          await this.refreshTasks();
          break;
        case 'checkInitialization':
          await this.checkInitializationStatus();
          break;
        case 'installCLI':
          await this.handleInstallCLI();
          break;
        case 'initializeRover':
          await this.handleInitializeRover();
          break;
        case 'inspectTask':
          await this.handleInspectTask(data.taskId, data.taskTitle);
          break;
        case 'gitCompare':
          await this.handleGitCompareTask(data.taskId);
          break;
        case 'pushBranch':
          await this.handlePushBranch(data.taskId);
          break;
        case 'iterateTask':
          await this.handleIterateTask(data.taskId);
          break;
        case 'mergeTask':
          await this.handleMergeTask(data.taskId);
          break;
        case 'deleteTask':
          await this.handleDeleteTask(data.taskId, data.taskTitle);
          break;
        case 'openShell':
          await this.handleOpenShell(data.taskId);
          break;
        case 'viewLogs':
          await this.handleViewLogs(data.taskId, data.taskStatus);
          break;
        case 'openWorkspace':
          await this.handleOpenWorkspace(data.taskId);
          break;
        case 'checkRoverInitialization':
          await this.checkRoverInitialized();
          break;
        case 'getFormData':
          await this.handleGetFormData();
          break;
      }
    });

    // Check initialization status first
    this.checkInitializationStatus();
  }

  private async handleCreateTask(description: string, agent?: string, sourceBranch?: string) {
    if (!description || description.trim().length === 0) {
      vscode.window.showErrorMessage('Please enter a task description');
      return;
    }

    try {
      await vscode.commands.executeCommand(
        'rover.createTask',
        description.trim(),
        agent,
        sourceBranch
      );
      // Refresh tasks after creation
      setTimeout(() => this.refreshTasks(), 1000);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create task: ${error}`);
    }
  }

  private async handleInspectTask(taskId: string, taskTitle: string) {
    await vscode.commands.executeCommand('rover.inspectTask', {
      id: taskId,
      task: { id: taskId, title: taskTitle },
    });
  }

  private async handleGitCompareTask(taskId: string) {
    await vscode.commands.executeCommand('rover.gitCompareTask', {
      id: taskId,
      task: { id: taskId },
    });
  }

  private async handlePushBranch(taskId: string) {
    await vscode.commands.executeCommand('rover.pushBranch', {
      id: taskId,
      task: { id: taskId },
    });
  }

  private async handleIterateTask(taskId: string) {
    await vscode.commands.executeCommand('rover.iterateTask', {
      id: taskId,
      task: { id: taskId },
    });
  }

  private async handleMergeTask(taskId: string) {
    await vscode.commands.executeCommand('rover.mergeTask', {
      id: taskId,
      task: { id: taskId },
    });
  }

  private async handleDeleteTask(taskId: string, taskTitle: string) {
    await vscode.commands.executeCommand('rover.deleteTask', {
      id: taskId,
      task: { id: taskId, title: taskTitle },
    });
    setTimeout(() => this.refreshTasks(), 500);
  }

  private async handleOpenShell(taskId: string) {
    await vscode.commands.executeCommand('rover.shell', {
      id: taskId,
      task: { id: taskId },
    });
  }

  private async handleViewLogs(taskId: string, taskStatus: string) {
    const shouldFollow = ['running', 'initializing', 'installing'].includes(
      taskStatus
    );
    await vscode.commands.executeCommand('rover.logs', {
      id: taskId,
      task: { id: taskId, status: taskStatus },
    });
  }

  private async handleOpenWorkspace(taskId: string) {
    await vscode.commands.executeCommand('rover.openWorkspace', {
      id: taskId,
      task: { id: taskId },
    });
  }

  private async checkInitializationStatus() {
    if (!this._view) {
      return;
    }

    try {
      const cliStatus = await this.cli.checkInstallation();
      const roverInitialized = await this.cli.checkInitialization();

      const status = {
        cliInstalled: cliStatus.installed,
        cliVersion: cliStatus.version,
        roverInitialized,
        error: cliStatus.error,
      };

      this._view.webview.postMessage({
        command: 'updateInitializationStatus',
        status: status,
      });

      // If everything is initialized, start auto-refresh and load tasks
      if (status.cliInstalled && status.roverInitialized) {
        this.startAutoRefresh();
        this.refreshTasks();
      }
    } catch (error) {
      console.error('Failed to check initialization status:', error);
      this._view.webview.postMessage({
        command: 'updateInitializationStatus',
        status: {
          cliInstalled: false,
          roverInitialized: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  private async handleInstallCLI() {
    await vscode.commands.executeCommand('rover.install');
    // Check status again after installation attempt
    setTimeout(() => this.checkInitializationStatus(), 2000);
  }

  private async handleInitializeRover() {
    await vscode.commands.executeCommand('rover.init');
    // Check status again after initialization attempt
    setTimeout(() => this.checkInitializationStatus(), 2000);
  }

  private async refreshTasks() {
    if (!this._view) {
      return;
    }

    try {
      const tasks = await this.cli.getTasks();
      this._view.webview.postMessage({
        command: 'updateTasks',
        tasks: tasks,
      });
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
      this._view.webview.postMessage({
        command: 'updateTasks',
        tasks: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private startAutoRefresh(): void {
    const interval = vscode.workspace
      .getConfiguration('rover')
      .get<number>('autoRefreshInterval', 5000);
    if (interval > 0) {
      this.autoRefreshInterval = setInterval(() => {
        this.refreshTasks();
      }, interval);
    }
  }

  public dispose(): void {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
    }
  }

  public refresh(): void {
    this.checkInitializationStatus();
  }

  private async checkRoverInitialized() {
    if (!this._view) {
      return;
    }

    try {
      this._view.webview.postMessage({
        command: 'roverInitializationChecked',
        isInitialized: await this.cli.checkInitialization(),
      });
    } catch (error) {
      console.error('Failed to check rover initialization files:', error);
    }
  }

  private async handleGetFormData() {
    if (!this._view) {
      return;
    }

    try {
      const [agents, branches] = await Promise.all([
        this.getAvailableAgents(),
        this.getAvailableBranches()
      ]);

      // Get current branch for better default selection
      const currentBranch = await this.getCurrentBranch();
      
      this._view.webview.postMessage({
        command: 'updateFormData',
        agents,
        branches,
        currentBranch,
      });
    } catch (error) {
      console.error('Failed to get form data:', error);
      this._view.webview.postMessage({
        command: 'updateFormData',
        agents: [],
        branches: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async getAvailableAgents(): Promise<{ agents: string[], defaultAgent?: string }> {
    if (!this.cli.workspaceRoot) {
      return { agents: ['claude'], defaultAgent: 'claude' };
    }

    try {
      const settingsPath = vscode.Uri.joinPath(
        this.cli.workspaceRoot,
        '.rover',
        'settings.json'
      );

      const settingsData = await vscode.workspace.fs.readFile(settingsPath);
      const settingsText = settingsData.toString();
      
      // Validate that it's valid JSON and has expected structure
      let settings: any;
      try {
        settings = JSON.parse(settingsText);
      } catch (jsonError) {
        console.warn('Invalid JSON in settings file:', jsonError);
        return { agents: ['claude'], defaultAgent: 'claude' };
      }

      // Validate that settings is an object
      if (!settings || typeof settings !== 'object') {
        console.warn('Settings file does not contain a valid object');
        return { agents: ['claude'], defaultAgent: 'claude' };
      }

      // Safe property access with validation
      const agents = Array.isArray(settings.aiAgents) ? 
        settings.aiAgents.filter((agent: any) => typeof agent === 'string') : 
        ['claude'];
      
      const defaultAgent = (typeof settings.defaults?.aiAgent === 'string') ? 
        settings.defaults.aiAgent : 
        (agents.length > 0 ? agents[0] : 'claude');

      return {
        agents: agents.length > 0 ? agents : ['claude'],
        defaultAgent
      };
    } catch (error) {
      console.warn('Failed to read settings file:', error);
      // Fallback to default if settings file doesn't exist or is invalid
      return { agents: ['claude'], defaultAgent: 'claude' };
    }
  }

  private async getCurrentBranch(): Promise<string | null> {
    if (!this.cli.workspaceRoot) {
      return null;
    }

    try {
      const { stdout, exitCode } = await launch(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        {
          cwd: this.cli.workspaceRoot.fsPath,
          env: process.env,
        }
      );

      if (exitCode === 0 && stdout) {
        const branch = stdout.toString().trim();
        return branch && branch !== 'HEAD' ? branch : null;
      }
      
      return null;
    } catch (error) {
      console.warn('Failed to get current branch:', error);
      return null;
    }
  }

  private async getAvailableBranches(): Promise<string[]> {
    if (!this.cli.workspaceRoot) {
      return ['main'];
    }

    try {
      const { stdout, exitCode, stderr } = await launch(
        'git',
        ['branch', '--format=%(refname:short)'],
        {
          cwd: this.cli.workspaceRoot.fsPath,
          env: process.env,
        }
      );

      if (exitCode !== 0) {
        console.warn(`Git branch command failed (exit code ${exitCode}):`, stderr?.toString());
        
        // Try alternative approach for older git versions
        try {
          const { stdout: altStdout, exitCode: altExitCode } = await launch(
            'git',
            ['branch'],
            {
              cwd: this.cli.workspaceRoot.fsPath,
              env: process.env,
            }
          );

          if (altExitCode === 0 && altStdout) {
            const branches = altStdout
              .toString()
              .split('\n')
              .map(branch => branch.replace(/^\*?\s+/, '').trim())
              .filter(branch => branch.length > 0 && !branch.startsWith('('))
              .sort();

            return branches.length > 0 ? branches : ['main'];
          }
        } catch (altError) {
          console.warn('Alternative git branch command also failed:', altError);
        }
        
        return ['main'];
      }

      if (!stdout) {
        return ['main'];
      }

      const branches = stdout
        .toString()
        .trim()
        .split('\n')
        .filter(branch => branch.length > 0)
        .map(branch => branch.trim())
        .sort();

      return branches.length > 0 ? branches : ['main'];
    } catch (error) {
      console.warn('Failed to get git branches:', error);
      // Fallback to main if git command fails
      return ['main'];
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    // Get Codicons URI
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'codicons', 'codicon.css')
    );

    // Get the bundled tasks-webview component URI
    const tasksWebviewUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        'dist',
        'views',
        'tasks-webview.js'
      )
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rover Tasks</title>
    <link href="${codiconsUri}" rel="stylesheet" />
    <style>
      body {
        margin: 0;
        padding: 0;
        overflow: hidden;
        height: 100vh;
      }
    </style>
</head>
<body>
    <script src="${tasksWebviewUri}"></script>
</body>
</html>`;
  }
}
