import * as vscode from 'vscode';
import { RoverCLI } from '../rover/cli.mjs';
import { FileSystemHelper } from '../rover/fileSystem.js';

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
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'src')
      ]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.command) {
        case 'createTask':
          await this.handleCreateTask(data.description);
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
      }
    });

    // Check initialization status first
    this.checkInitializationStatus();
  }

  private async handleCreateTask(description: string) {
    if (!description || description.trim().length === 0) {
      vscode.window.showErrorMessage('Please enter a task description');
      return;
    }

    try {
      await vscode.commands.executeCommand('rover.createTask', description.trim());
      // Refresh tasks after creation
      setTimeout(() => this.refreshTasks(), 1000);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to create task: ${error}`);
    }
  }

  private async handleInspectTask(taskId: string, taskTitle: string) {
    await vscode.commands.executeCommand('rover.inspectTask', { id: taskId, task: { id: taskId, title: taskTitle } });
  }

  private async handleGitCompareTask(taskId: string) {
    await vscode.commands.executeCommand('rover.gitCompareTask', { id: taskId, task: { id: taskId } });
  }

  private async handlePushBranch(taskId: string) {
    await vscode.commands.executeCommand('rover.pushBranch', { id: taskId, task: { id: taskId } });
  }

  private async handleIterateTask(taskId: string) {
    await vscode.commands.executeCommand('rover.iterateTask', { id: taskId, task: { id: taskId } });
  }

  private async handleMergeTask(taskId: string) {
    await vscode.commands.executeCommand('rover.mergeTask', { id: taskId, task: { id: taskId } });
  }

  private async handleDeleteTask(taskId: string, taskTitle: string) {
    await vscode.commands.executeCommand('rover.deleteTask', { id: taskId, task: { id: taskId, title: taskTitle } });
    setTimeout(() => this.refreshTasks(), 500);
  }

  private async handleOpenShell(taskId: string) {
    await vscode.commands.executeCommand('rover.shell', { id: taskId, task: { id: taskId } });
  }

  private async handleViewLogs(taskId: string, taskStatus: string) {
    const shouldFollow = ['running', 'initializing', 'installing'].includes(taskStatus);
    await vscode.commands.executeCommand('rover.logs', { id: taskId, task: { id: taskId, status: taskStatus } });
  }

  private async handleOpenWorkspace(taskId: string) {
    await vscode.commands.executeCommand('rover.openWorkspace', { id: taskId, task: { id: taskId } });
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
        error: cliStatus.error
      };

      this._view.webview.postMessage({
        command: 'updateInitializationStatus',
        status: status
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
          error: error instanceof Error ? error.message : 'Unknown error'
        }
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
        tasks: tasks
      });
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
      this._view.webview.postMessage({
        command: 'updateTasks',
        tasks: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private startAutoRefresh(): void {
    const interval = vscode.workspace.getConfiguration('rover').get<number>('autoRefreshInterval', 5000);
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
        isInitialized: await this.cli.checkInitialization()
      });
    } catch (error) {
      console.error('Failed to check rover initialization files:', error);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    // Get Codicons URI
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'codicons', 'codicon.css')
    );

    // Get the bundled tasks-webview component URI
    const tasksWebviewUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'views', 'tasks-webview.js')
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
