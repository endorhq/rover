import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RoverCLI } from '../rover/cli.mjs';
import { TaskDetails } from '../rover/types.js';

export class TaskDetailsPanel {
  public static currentPanel: TaskDetailsPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private readonly _cli: RoverCLI;

  public static createOrShow(
    extensionUri: vscode.Uri,
    taskId: string,
    taskTitle: string
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    // If we already have a panel, show it
    if (TaskDetailsPanel.currentPanel) {
      TaskDetailsPanel.currentPanel._panel.reveal(column);
      TaskDetailsPanel.currentPanel.loadTaskDetails(taskId);
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      'roverTaskDetails',
      `Task: ${taskTitle}`,
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist'),
          vscode.Uri.joinPath(extensionUri, 'src'),
        ],
      }
    );

    TaskDetailsPanel.currentPanel = new TaskDetailsPanel(
      panel,
      extensionUri,
      taskId
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    taskId: string
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._cli = new RoverCLI();

    // Set the webview's initial html content
    this._update();

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case 'ready':
            this.loadTaskDetails(taskId);
            return;
          case 'openFile':
            this.openFile(message.filePath);
            return;
          case 'executeAction':
            this.executeAction(message.action, message.taskId);
            return;
        }
      },
      null,
      this._disposables
    );

    // Load initial task details
    this.loadTaskDetails(taskId);
  }

  private async loadTaskDetails(taskId: string) {
    try {
      const taskDetails = await this._cli.inspectTask(taskId);
      const enhancedDetails =
        await this.enhanceTaskDetailsWithIterations(taskDetails);

      this._panel.webview.postMessage({
        command: 'updateTaskData',
        data: enhancedDetails,
      });
    } catch (error) {
      this._panel.webview.postMessage({
        command: 'showError',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async enhanceTaskDetailsWithIterations(
    taskDetails: TaskDetails
  ): Promise<TaskDetails & { iterations: any[] }> {
    const iterations: any[] = [];

    // Get workspace root
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      console.warn('No workspace root available for task iterations');
      return { ...taskDetails, iterations };
    }

    // Validate taskDetails.id
    if (!taskDetails.id) {
      console.warn('Task ID is undefined or empty');
      return { ...taskDetails, iterations };
    }

    // Check for task directory
    const taskDir = path.join(
      workspaceRoot,
      '.rover',
      'tasks',
      taskDetails.id.toString()
    );
    if (!fs.existsSync(taskDir)) {
      console.info(`Task directory does not exist: ${taskDir}`);
      return { ...taskDetails, iterations };
    }

    try {
      // Look for iteration directories (typically numbered)
      const iterationsDir = path.join(taskDir, 'iterations');
      const entries = fs.readdirSync(iterationsDir, { withFileTypes: true });
      const iterationDirs = entries
        .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
        .sort((a, b) => parseInt(a.name) - parseInt(b.name));

      for (const iterationDir of iterationDirs) {
        const iterationPath = path.join(iterationsDir, iterationDir.name);
        const iterationNumber = parseInt(iterationDir.name);

        // Check for common files in iteration directory
        // Use iterationFiles from taskDetails if available, otherwise fall back to hardcoded list
        const defaultFiles = [
          'context.md',
          'plan.md',
          'changes.md',
          'review.md',
          'summary.md',
        ];
        const fileList = taskDetails.iterationFiles || defaultFiles;
        const files = fileList.map(fileName => {
          const filePath = path.join(iterationPath, fileName);
          const exists = fs.existsSync(filePath);
          return {
            name: fileName,
            path: filePath,
            content: exists ? fs.readFileSync(filePath, 'utf8') : null,
            exists,
          };
        });

        // Try to get iteration metadata if available
        const metadataPath = path.join(iterationPath, 'status.json');
        let iterationMeta: any = {
          number: iterationNumber,
          status: 'unknown',
        };

        if (fs.existsSync(metadataPath)) {
          try {
            const metadataContent = fs.readFileSync(metadataPath, 'utf8');
            iterationMeta = {
              ...iterationMeta,
              ...JSON.parse(metadataContent),
            };
          } catch (error) {
            // Ignore metadata parsing errors
          }
        }

        iterations.push({
          ...iterationMeta,
          files,
        });
      }
    } catch (error) {
      console.warn('Error reading task iterations:', error);
    }

    return { ...taskDetails, iterations };
  }

  private async openFile(filePath: string) {
    try {
      const uri = vscode.Uri.file(filePath);

      // Check if it's a markdown file
      if (filePath.endsWith('.md')) {
        // Open markdown preview
        await vscode.commands.executeCommand('markdown.showPreview', uri);
      } else {
        // Open as regular text document
        await vscode.window.showTextDocument(uri, {
          preview: true,
          viewColumn: vscode.ViewColumn.Beside,
        });
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open file: ${error}`);
    }
  }

  private async executeAction(action: string, taskId: string) {
    if (!taskId) {
      vscode.window.showErrorMessage('Task ID is missing');
      return;
    }

    switch (action) {
      case 'logs':
        vscode.commands.executeCommand('rover.logs', {
          id: taskId,
          task: { id: taskId },
        });
        break;
      case 'shell':
        vscode.commands.executeCommand('rover.shell', {
          id: taskId,
          task: { id: taskId },
        });
        break;
      case 'delete':
        const confirmed = await vscode.window.showWarningMessage(
          `Are you sure you want to delete task "${taskId}"?`,
          'Yes',
          'No'
        );
        if (confirmed === 'Yes') {
          vscode.commands.executeCommand('rover.deleteTask', {
            id: taskId,
            task: { id: taskId },
          });
          this.dispose(); // Close the panel after deletion
        }
        break;
      case 'refresh':
        this.loadTaskDetails(taskId);
        break;
      case 'openWorkspace':
        vscode.commands.executeCommand('rover.openWorkspace', {
          id: taskId,
          task: { id: taskId },
        });
        break;
      default:
        vscode.window.showWarningMessage(`Unknown action: ${action}`);
    }
  }

  public dispose() {
    TaskDetailsPanel.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview();
  }

  private _getHtmlForWebview(): string {
    // Get Codicons URI
    const codiconsUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'codicons', 'codicon.css')
    );

    // Get the bundled task-details component URI
    const taskDetailsUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        'dist',
        'views',
        'task-details.js'
      )
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Task Details</title>
    <link href="${codiconsUri}" rel="stylesheet" />
    <style>
      body {
        margin: 0;
        padding: 0;
        overflow-y: auto;
        height: 100vh;
      }
    </style>
</head>
<body>
    <script src="${taskDetailsUri}"></script>
</body>
</html>`;
  }
}
