import * as vscode from 'vscode';
import { TaskTreeProvider } from './providers/TaskTreeProvider';
import { TasksWebviewProvider } from './providers/TasksWebviewProvider';
import { RoverCLI } from './rover/cli';
import { TaskItem } from './providers/TaskItem';
import { TaskDetailsPanel } from './panels/TaskDetailsPanel';

let taskTreeProvider: TaskTreeProvider;
let tasksWebviewProvider: TasksWebviewProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('Rover extension is now active!');

    // Initialize the CLI wrapper
    const cli = new RoverCLI();

    // Create and register the Tasks Webview Provider (replaces tree view)
    tasksWebviewProvider = new TasksWebviewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(TasksWebviewProvider.viewType, tasksWebviewProvider)
    );

    // Keep the old tree provider for fallback if needed
    taskTreeProvider = new TaskTreeProvider();
    context.subscriptions.push(taskTreeProvider);

    // Register the refresh command
    const refreshCommand = vscode.commands.registerCommand('rover.refresh', () => {
        // Use webview provider's refresh method
        vscode.commands.executeCommand('workbench.action.webview.reloadWebviewAction');
    });
    context.subscriptions.push(refreshCommand);

    // Register the create task command
    const createTaskCommand = vscode.commands.registerCommand('rover.createTask', async (description?: string) => {
        // If no description provided, show input box (existing behavior)
        if (!description) {
            description = await vscode.window.showInputBox({
                prompt: 'Enter task description',
                placeHolder: 'e.g., Fix the login bug in authentication module',
                ignoreFocusOut: true
            });
        }

        if (description) {
            let statusBarItem: vscode.StatusBarItem | undefined;

            try {
                // Create status bar item for persistent progress indication
                statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
                statusBarItem.text = '$(loading~spin) Creating task...';
                statusBarItem.show();

                const createdTask = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Creating Rover Task',
                    cancellable: false
                }, async (progress, token) => {
                    // Step 1: Validating description
                    progress.report({
                        increment: 10,
                        message: 'Validating task description...'
                    });
                    statusBarItem!.text = '$(loading~spin) Validating description...';
                    await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause for UX

                    // Step 2: Initializing task
                    progress.report({
                        increment: 20,
                        message: 'Initializing task environment...'
                    });
                    statusBarItem!.text = '$(loading~spin) Initializing environment...';

                    // Step 3: Creating task (this is the actual CLI call)
                    progress.report({
                        increment: 30,
                        message: 'Creating task and expanding with AI...'
                    });
                    statusBarItem!.text = '$(loading~spin) Expanding task with AI...';

                    const createdTask = await cli.createTask(description);

                    // Step 4: Finalizing
                    progress.report({
                        increment: 40,
                        message: 'Finalizing task setup...'
                    });
                    statusBarItem!.text = '$(loading~spin) Finalizing setup...';
                    await new Promise(resolve => setTimeout(resolve, 300)); // Brief pause for UX

                    return createdTask;
                });

                // Update status bar to show success
                statusBarItem.text = '$(check) Task created successfully';
                statusBarItem.tooltip = `Task: ${createdTask.title} (${createdTask.id})`;

                // Auto-hide status bar item after 3 seconds
                setTimeout(() => {
                    statusBarItem?.dispose();
                }, 3000);

                vscode.window.showInformationMessage(`Task created successfully! "${createdTask.title}" (ID: ${createdTask.id})`);
                taskTreeProvider.refresh();
            } catch (error) {
                // Update status bar to show error
                if (statusBarItem) {
                    statusBarItem.text = '$(error) Task creation failed';
                    statusBarItem.tooltip = `Error: ${error}`;
                    setTimeout(() => {
                        statusBarItem?.dispose();
                    }, 5000);
                }

                vscode.window.showErrorMessage(`Failed to create task: ${error}`);
            }
        }
    });
    context.subscriptions.push(createTaskCommand);

    // Task creation is now handled by the webview

    // Register the inspect task command
    const inspectTaskCommand = vscode.commands.registerCommand('rover.inspectTask', async (item: TaskItem | any) => {
        try {
            if (!item) {
                const id = await vscode.window.showInputBox({
                    prompt: 'Enter task ID',
                    placeHolder: '1',
                    ignoreFocusOut: true
                });

                if (!id) {
                    throw new Error('Invalid task ID');
                }

                item = {
                    id: parseInt(id)
                }
            }

            // Validate the item parameter
            if (!item) {
                throw new Error('No task item provided');
            }

            // Handle different item formats (TaskItem vs direct task object)
            let taskId: string;
            let taskTitle: string;

            if (item.task) {
                // TaskItem format
                taskId = item.task.id;
                taskTitle = item.task.title;
            } else if (item.id) {
                // Direct task object format
                taskId = item.id;
                taskTitle = item.title || `Task ${item.id}`;
            } else {
                throw new Error('Invalid task item format - missing task ID');
            }

            if (!taskId) {
                throw new Error('Task ID is undefined or empty');
            }

            TaskDetailsPanel.createOrShow(context.extensionUri, taskId, taskTitle);
        } catch (error) {
            console.error('Error in inspectTask command:', error);
            vscode.window.showErrorMessage(`Failed to open task details: ${error}`);
        }
    });
    context.subscriptions.push(inspectTaskCommand);

    // Register the delete task command
    const deleteTaskCommand = vscode.commands.registerCommand('rover.deleteTask', async (item: TaskItem | any) => {
        try {
            // Validate and extract task info
            let taskId: string;
            let taskTitle: string;

            if (item?.task) {
                taskId = item.task.id;
                taskTitle = item.task.title;
            } else if (item?.id) {
                taskId = item.id;
                taskTitle = item.title || `Task ${item.id}`;
            } else {
                throw new Error('Invalid task item - missing task information');
            }

            const answer = await vscode.window.showWarningMessage(
                `Are you sure you want to delete task "${taskTitle}"?`,
                'Yes',
                'No'
            );

            if (answer === 'Yes') {
                await cli.deleteTask(taskId);
                vscode.window.showInformationMessage('Task deleted successfully!');
                taskTreeProvider.refresh();
            }
        } catch (error) {
            console.error('Error in deleteTask command:', error);
            vscode.window.showErrorMessage(`Failed to delete task: ${error}`);
        }
    });
    context.subscriptions.push(deleteTaskCommand);

    // Register the shell command
    const shellCommand = vscode.commands.registerCommand('rover.shell', (item: TaskItem | any) => {
        try {
            const taskId = item?.task?.id || item?.id;
            if (!taskId) {
                throw new Error('Invalid task item - missing task ID');
            }
            cli.startShell(taskId);
        } catch (error) {
            console.error('Error in shell command:', error);
            vscode.window.showErrorMessage(`Failed to open shell: ${error}`);
        }
    });
    context.subscriptions.push(shellCommand);

    // Register the logs command
    const logsCommand = vscode.commands.registerCommand('rover.logs', async (item: TaskItem | any) => {
        try {
            const taskId = item?.task?.id || item?.id;
            const taskStatus = item?.task?.status || item?.status;

            if (!taskId) {
                throw new Error('Invalid task item - missing task ID');
            }

            // Only follow logs for running tasks
            const shouldFollow = ['running', 'initializing', 'installing'].includes(taskStatus);
            await cli.showLogs(taskId, shouldFollow);
        } catch (error) {
            console.error('Error in logs command:', error);
            vscode.window.showErrorMessage(`Failed to show logs: ${error}`);
        }
    });
    context.subscriptions.push(logsCommand);

    // Register the open workspace command
    const openWorkspaceCommand = vscode.commands.registerCommand('rover.openWorkspace', async (item: TaskItem | any) => {
        try {
            const taskId = item?.task?.id || item?.id;
            const taskTitle = item?.task?.title || item?.title || `Task ${taskId}`;

            if (!taskId) {
                throw new Error('Invalid task item - missing task ID');
            }

            const workspacePath = await cli.getTaskWorkspacePath(taskId);

            // Check if the workspace directory exists
            const workspaceUri = vscode.Uri.file(workspacePath);
            try {
                await vscode.workspace.fs.stat(workspaceUri);
            } catch (error) {
                vscode.window.showWarningMessage(`Task workspace directory does not exist: ${workspacePath}`);
                return;
            }

            // Open the workspace in a new window
            const success = await vscode.commands.executeCommand('vscode.openFolder', workspaceUri, {
                forceNewWindow: true
            });

            if (success) {
                vscode.window.showInformationMessage(`Opened workspace for task: ${taskTitle}`);
            }
        } catch (error) {
            console.error('Error in openWorkspace command:', error);
            vscode.window.showErrorMessage(`Failed to open workspace: ${error}`);
        }
    });
    context.subscriptions.push(openWorkspaceCommand);

    // Clean up the tree provider when extension is deactivated
    context.subscriptions.push({
        dispose: () => {
            taskTreeProvider.dispose();
        }
    });
}

export function deactivate() {
    if (taskTreeProvider) {
        taskTreeProvider.dispose();
    }
}