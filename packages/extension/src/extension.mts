import * as vscode from 'vscode';
import * as path from 'path';
import { TasksLitWebviewProvider } from './providers/TasksLitWebviewProvider.mjs';
import { RoverCLI } from './rover/cli.mjs';
import { TaskItem } from './providers/TaskItem.mjs';
import { TaskDetailsPanel } from './panels/TaskDetailsPanel.mjs';
import { getTelemetry } from './lib/telemetry.mjs';
import { NewTaskProvider } from 'rover-telemetry';
import { launch, launchSync } from 'rover-common';

let tasksWebviewProvider: TasksLitWebviewProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log('Rover extension is now active!');

  const telemetry = getTelemetry();

  // Initialize the CLI wrapper
  const cli = new RoverCLI();

  // Create and register the Tasks Webview Provider (replaces tree view)
  tasksWebviewProvider = new TasksLitWebviewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TasksLitWebviewProvider.viewType,
      tasksWebviewProvider
    )
  );

  // Register the refresh command
  const refreshCommand = vscode.commands.registerCommand(
    'rover.refresh',
    () => {
      // Use webview provider's refresh method
      vscode.commands.executeCommand(
        'workbench.action.webview.reloadWebviewAction'
      );
    }
  );
  context.subscriptions.push(refreshCommand);

  // Register the create task command
  const createTaskCommand = vscode.commands.registerCommand(
    'rover.createTask',
    async (description?: string) => {
      // If no description provided, show input box (existing behavior)
      if (!description) {
        description = await vscode.window.showInputBox({
          prompt: 'Enter task description',
          placeHolder: 'e.g., Fix the login bug in authentication module',
          ignoreFocusOut: true,
        });
      }

      if (description) {
        let statusBarItem: vscode.StatusBarItem | undefined;

        try {
          // Create status bar item for persistent progress indication
          statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
          );
          statusBarItem.text = '$(loading~spin) Creating task...';
          statusBarItem.show();

          const createdTask = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Creating Rover Task',
              cancellable: false,
            },
            async (progress, token) => {
              // Step 1: Validating description
              progress.report({
                increment: 10,
                message: 'Validating task description...',
              });
              statusBarItem!.text = '$(loading~spin) Validating description...';
              await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause for UX

              // Step 2: Initializing task
              progress.report({
                increment: 20,
                message: 'Initializing task environment...',
              });
              statusBarItem!.text =
                '$(loading~spin) Initializing environment...';

              // Step 3: Creating task (this is the actual CLI call)
              progress.report({
                increment: 30,
                message: 'Creating task and expanding with AI...',
              });
              statusBarItem!.text = '$(loading~spin) Expanding task with AI...';

              const createdTask = await cli.createTask(description);

              // Step 4: Finalizing
              progress.report({
                increment: 40,
                message: 'Finalizing task setup...',
              });
              statusBarItem!.text = '$(loading~spin) Finalizing setup...';
              await new Promise(resolve => setTimeout(resolve, 300)); // Brief pause for UX

              telemetry?.eventNewTask(NewTaskProvider.INPUT);

              return createdTask;
            }
          );

          // Update status bar to show success
          statusBarItem.text = '$(check) Task created successfully';
          statusBarItem.tooltip = `Task: ${createdTask.title} (${createdTask.id})`;

          // Auto-hide status bar item after 3 seconds
          setTimeout(() => {
            statusBarItem?.dispose();
          }, 3000);

          vscode.window.showInformationMessage(
            `Task created successfully! "${createdTask.title}" (ID: ${createdTask.id})`
          );
          tasksWebviewProvider.refresh();
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
    }
  );
  context.subscriptions.push(createTaskCommand);

  // Task creation is now handled by the webview

  // Register the inspect task command
  const inspectTaskCommand = vscode.commands.registerCommand(
    'rover.inspectTask',
    async (item: TaskItem | any) => {
      try {
        if (!item) {
          const id = await vscode.window.showInputBox({
            prompt: 'Enter task ID',
            placeHolder: '1',
            ignoreFocusOut: true,
          });

          if (!id) {
            throw new Error('Invalid task ID');
          }

          item = {
            id: parseInt(id),
          };
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

        telemetry?.eventInspectTask();

        TaskDetailsPanel.createOrShow(context.extensionUri, taskId, taskTitle);
      } catch (error) {
        console.error('Error in inspectTask command:', error);
        vscode.window.showErrorMessage(`Failed to open task details: ${error}`);
      }
    }
  );
  context.subscriptions.push(inspectTaskCommand);

  // Register the git comppare task command
  const gitCompareTaskCommand = vscode.commands.registerCommand(
    'rover.gitCompareTask',
    async (item: TaskItem | any) => {
      try {
        if (!item) {
          const id = await vscode.window.showInputBox({
            prompt: 'Enter task ID',
            placeHolder: '1',
            ignoreFocusOut: true,
          });

          if (!id) {
            throw new Error('Invalid task ID');
          }

          item = {
            id: parseInt(id),
          };
        }

        // Validate the item parameter
        if (!item) {
          throw new Error('No task item provided');
        }

        // Handle different item formats (TaskItem vs direct task object)
        let taskId: string;

        if (item.task) {
          // TaskItem format
          taskId = item.task.id;
        } else if (item.id) {
          // Direct task object format
          taskId = item.id;
        } else {
          throw new Error('Invalid task item format - missing task ID');
        }

        if (!taskId) {
          throw new Error('Task ID is undefined or empty');
        }

        // Get the task workspace path
        const taskWorkspacePath = await cli.getTaskWorkspacePath(taskId);

        // Get current workspace root
        const workspaceRoot =
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
          throw new Error('No workspace folder is open');
        }

        // Show progress while preparing comparison
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Preparing Git Comparison',
            cancellable: false,
          },
          async progress => {
            progress.report({
              increment: 0,
              message: 'Getting changed files in task workspace...',
            });

            // Get list of changed files in the task workspace
            let changedFiles: string[] = [];
            try {
              const { stdout: statusOutput } = launchSync(
                'git',
                ['status', '--porcelain', '-u'],
                { cwd: taskWorkspacePath }
              );
              changedFiles = statusOutput
                ? statusOutput
                    .toString()
                    .split('\n')
                    .filter(line => line.trim())
                    .map(line => line.substring(3).trim()) // Remove status flags (e.g., "M ", "A ", etc.)
                    .filter(file => file.length > 0)
                : [];
            } catch (error) {
              throw new Error(
                'Failed to get changed files from task workspace: ' + error
              );
            }

            if (changedFiles.length === 0) {
              vscode.window.showInformationMessage(
                'No changes found in task workspace'
              );
              return;
            }

            progress.report({
              increment: 30,
              message: `Found ${changedFiles.length} changed files. Preparing comparisons...`,
            });

            // Prepare the changes array for vscode.changes command
            const changes: [vscode.Uri, vscode.Uri, vscode.Uri][] = [];

            for (const file of changedFiles) {
              try {
                const taskFileUri = vscode.Uri.file(
                  path.join(taskWorkspacePath, file)
                );
                const originalFileUri = vscode.Uri.file(
                  path.join(workspaceRoot, file)
                );

                // Check if files exist
                const taskFileExists = await vscode.workspace.fs
                  .stat(taskFileUri)
                  .then(
                    () => true,
                    () => false
                  );
                const originalFileExists = await vscode.workspace.fs
                  .stat(originalFileUri)
                  .then(
                    () => true,
                    () => false
                  );

                if (taskFileExists && originalFileExists) {
                  // Both files exist - add to changes array
                  changes.push([
                    vscode.Uri.parse(file),
                    originalFileUri,
                    taskFileUri,
                  ]);
                } else if (taskFileExists && !originalFileExists) {
                  // New file in task - compare with empty file
                  changes.push([
                    taskFileUri,
                    vscode.Uri.parse('untitled:'), // Empty file
                    taskFileUri,
                  ]);
                } else if (!taskFileExists && originalFileExists) {
                  // File deleted in task - compare original with empty
                  changes.push([
                    vscode.Uri.parse(file),
                    originalFileUri,
                    vscode.Uri.parse('untitled:'), // Empty file
                  ]);
                }
              } catch (error) {
                console.warn(
                  `Failed to prepare comparison for file ${file}:`,
                  error
                );
              }
            }

            if (changes.length === 0) {
              vscode.window.showWarningMessage(
                'No file comparisons could be prepared'
              );
              return;
            }

            progress.report({
              increment: 70,
              message: `Opening ${changes.length} file comparisons...`,
            });

            telemetry?.eventDiff();

            try {
              // Use vscode.changes command with the array of changes
              await vscode.commands.executeCommand(
                'vscode.changes',
                `Changes on task ${taskId}`,
                changes
              );
              progress.report({
                increment: 100,
                message: 'Git changes view opened',
              });
              vscode.window.showInformationMessage(
                `Opened git changes view with ${changes.length} file comparison(s) between current branch and task workspace`
              );
            } catch (error) {
              console.log('vscode.changes command failed:', error);
            }
          }
        );
      } catch (error) {
        console.error('Error in gitCompareTask command:', error);
        vscode.window.showErrorMessage(
          `Failed to compare task changes: ${error}`
        );
      }
    }
  );
  context.subscriptions.push(gitCompareTaskCommand);

  // Register the push task command
  const pushBranchCommand = vscode.commands.registerCommand(
    'rover.pushBranch',
    async (item: TaskItem | any) => {
      try {
        if (!item) {
          const id = await vscode.window.showInputBox({
            prompt: 'Enter task ID',
            placeHolder: '1',
            ignoreFocusOut: true,
          });

          if (!id) {
            throw new Error('Invalid task ID');
          }

          item = {
            id: parseInt(id),
          };
        }

        // Validate the item parameter
        if (!item) {
          throw new Error('No task item provided');
        }

        const message = await vscode.window.showInputBox({
          prompt: 'Commit message',
          placeHolder: 'feat: add ...',
          ignoreFocusOut: true,
        });

        if (!message) {
          throw new Error('Invalid commit message');
        }

        // Handle different item formats (TaskItem vs direct task object)
        let taskId: string;

        if (item.task) {
          // TaskItem format
          taskId = item.task.id;
        } else if (item.id) {
          // Direct task object format
          taskId = item.id;
        } else {
          throw new Error('Invalid task item format - missing task ID');
        }

        if (!taskId) {
          throw new Error('Task ID is undefined or empty');
        }

        let statusBarItem: vscode.StatusBarItem | undefined;

        try {
          // Create status bar item for persistent progress indication
          statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
          );
          statusBarItem.text = '$(loading~spin) Creating task...';
          statusBarItem.show();

          const pushResult = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Pushing Task Branch',
              cancellable: false,
            },
            async (progress, _token) => {
              // Step 1: Validating description
              progress.report({
                increment: 10,
                message: 'Retrieving Task data...',
              });
              statusBarItem!.text = '$(loading~spin) Retrieving Task data...';
              await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause for UX

              // Step 2: Initializing task
              progress.report({
                increment: 20,
                message: 'Pushing branch...',
              });
              statusBarItem!.text = '$(loading~spin) Pushing branch...';

              const pushResult = await cli.pushBranch(taskId, message);

              // Step 4: Finalizing
              progress.report({
                increment: 40,
                message: 'Finalizing push...',
              });
              statusBarItem!.text = '$(loading~spin) Finalizing push...';
              await new Promise(resolve => setTimeout(resolve, 300)); // Brief pause for UX

              return pushResult;
            }
          );

          telemetry?.eventPushBranch();

          if (pushResult.success) {
            statusBarItem.text = `$(check) Task pushed successfully (Branch: ${pushResult.branchName})!`;
            statusBarItem.tooltip = `Task: ${pushResult.taskTitle} (${pushResult.taskId})`;

            // Auto-hide status bar item after 3 seconds
            setTimeout(() => {
              statusBarItem?.dispose();
            }, 3000);

            vscode.window.showInformationMessage(
              `Task pushed successfully (Branch: ${pushResult.branchName})! "${pushResult.taskTitle}" (ID: ${pushResult.taskId})`
            );
          } else {
            statusBarItem.text = `$(error) Task push failed`;
            statusBarItem.tooltip = `Error: ${pushResult.error}`;

            setTimeout(() => {
              statusBarItem?.dispose();
            }, 5000);

            vscode.window.showErrorMessage(
              `Failed to push task: ${pushResult.error}`
            );
          }

          tasksWebviewProvider.refresh();
        } catch (error) {
          // Update status bar to show error
          if (statusBarItem) {
            statusBarItem.text = '$(error) Task push failed';
            statusBarItem.tooltip = `Error: ${error}`;
            setTimeout(() => {
              statusBarItem?.dispose();
            }, 5000);
          }

          vscode.window.showErrorMessage(`Failed to create task: ${error}`);
        }
      } catch (error) {
        console.error('Error in inspectTask command:', error);
        vscode.window.showErrorMessage(`Failed to open task details: ${error}`);
      }
    }
  );
  context.subscriptions.push(pushBranchCommand);

  // Register the push task command
  const iterateTaskCommand = vscode.commands.registerCommand(
    'rover.iterateTask',
    async (item: TaskItem | any) => {
      try {
        if (!item) {
          const id = await vscode.window.showInputBox({
            prompt: 'Enter task ID',
            placeHolder: '1',
            ignoreFocusOut: true,
          });

          if (!id) {
            throw new Error('Invalid task ID');
          }

          item = {
            id: parseInt(id),
          };
        }

        // Validate the item parameter
        if (!item) {
          throw new Error('No task item provided');
        }

        const instructions = await vscode.window.showInputBox({
          prompt: 'Iterate instructions',
          placeHolder: 'Update the X file to reuse the Y library',
          ignoreFocusOut: true,
        });

        if (!instructions) {
          throw new Error('Invalid instruction message');
        }

        // Handle different item formats (TaskItem vs direct task object)
        let taskId: string;

        if (item.task) {
          // TaskItem format
          taskId = item.task.id;
        } else if (item.id) {
          // Direct task object format
          taskId = item.id;
        } else {
          throw new Error('Invalid task item format - missing task ID');
        }

        if (!taskId) {
          throw new Error('Task ID is undefined or empty');
        }

        let statusBarItem: vscode.StatusBarItem | undefined;

        try {
          // Create status bar item for persistent progress indication
          statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
          );
          statusBarItem.text = '$(loading~spin) Creating a new iteration...';
          statusBarItem.show();

          const iterateResult = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Creating a new iteration',
              cancellable: false,
            },
            async (progress, _token) => {
              // Step 1: Validating description
              progress.report({
                increment: 10,
                message: 'Retrieving Task data...',
              });
              statusBarItem!.text = '$(loading~spin) Retrieving Task data...';
              await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause for UX

              // Step 2: Initializing task
              progress.report({
                increment: 20,
                message: 'Formatting prompt...',
              });
              statusBarItem!.text = '$(loading~spin) Formatting prompt...';

              const iterateResult = await cli.iterate(taskId, instructions);

              // Step 4: Finalizing
              progress.report({
                increment: 40,
                message: 'Waiting for the iteration to start...',
              });
              statusBarItem!.text =
                '$(loading~spin) Waiting for the iteration to start...';
              await new Promise(resolve => setTimeout(resolve, 300)); // Brief pause for UX

              return iterateResult;
            }
          );

          telemetry?.eventIterateTask(iterateResult.iterationNumber);

          if (iterateResult.success) {
            statusBarItem.text = `$(check) Task iteration started!`;
            statusBarItem.tooltip = `Task: ${iterateResult.taskTitle} (Iteration: ${iterateResult.iterationNumber})`;

            // Auto-hide status bar item after 3 seconds
            setTimeout(() => {
              statusBarItem?.dispose();
            }, 3000);

            vscode.window.showInformationMessage(`Task iteration started!`);
          } else {
            statusBarItem.text = `$(error) Task iteration failed`;
            statusBarItem.tooltip = `Error: ${iterateResult.error}`;

            setTimeout(() => {
              statusBarItem?.dispose();
            }, 5000);

            vscode.window.showErrorMessage(
              `Failed to push task: ${iterateResult.error}`
            );
          }

          tasksWebviewProvider.refresh();
        } catch (error) {
          // Update status bar to show error
          if (statusBarItem) {
            statusBarItem.text = '$(error) Task push failed';
            statusBarItem.tooltip = `Error: ${error}`;
            setTimeout(() => {
              statusBarItem?.dispose();
            }, 5000);
          }

          vscode.window.showErrorMessage(`Failed to create task: ${error}`);
        }
      } catch (error) {
        console.error('Error in inspectTask command:', error);
        vscode.window.showErrorMessage(`Failed to open task details: ${error}`);
      }
    }
  );
  context.subscriptions.push(iterateTaskCommand);

  const mergeTaskCommand = vscode.commands.registerCommand(
    'rover.mergeTask',
    async (item: TaskItem | any) => {
      try {
        if (!item) {
          const id = await vscode.window.showInputBox({
            prompt: 'Enter task ID',
            placeHolder: '1',
            ignoreFocusOut: true,
          });

          if (!id) {
            throw new Error('Invalid task ID');
          }

          item = {
            id: parseInt(id),
          };
        }

        // Validate the item parameter
        if (!item) {
          throw new Error('No task item provided');
        }

        // Handle different item formats (TaskItem vs direct task object)
        let taskId: string;

        if (item.task) {
          // TaskItem format
          taskId = item.task.id;
        } else if (item.id) {
          // Direct task object format
          taskId = item.id;
        } else {
          throw new Error('Invalid task item format - missing task ID');
        }

        if (!taskId) {
          throw new Error('Task ID is undefined or empty');
        }

        const answer = await vscode.window.showWarningMessage(
          `Are you sure you want to merge task ${taskId}?`,
          'Yes',
          'No'
        );

        if (answer !== 'Yes') {
          return;
        }

        let statusBarItem: vscode.StatusBarItem | undefined;

        try {
          // Create status bar item for persistent progress indication
          statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
          );
          statusBarItem.text = '$(loading~spin) Merging task...';
          statusBarItem.show();

          const mergeResult = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Merging the task',
              cancellable: false,
            },
            async (progress, _token) => {
              // Step 1: Validating description
              progress.report({
                increment: 10,
                message: 'Retrieving Task data...',
              });
              statusBarItem!.text = '$(loading~spin) Retrieving Task data...';
              await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause for UX

              // Step 2: Initializing task
              progress.report({
                increment: 20,
                message: 'Starting merge process...',
              });
              statusBarItem!.text = '$(loading~spin) Starting merge process...';

              await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause for UX
              statusBarItem!.text = '$(loading~spin) Merging task...';

              const mergeResult = await cli.mergeTask(taskId);

              // Step 4: Finalizing
              progress.report({
                increment: 40,
                message: 'Finalizing merge...',
              });
              statusBarItem!.text = '$(loading~spin) Finalizing merge...';
              await new Promise(resolve => setTimeout(resolve, 300)); // Brief pause for UX

              return mergeResult;
            }
          );

          telemetry?.eventMergeTask();

          if (mergeResult.success) {
            statusBarItem.text = `$(check) Task merged successfully!`;
            statusBarItem.tooltip = `Task: ${mergeResult.taskTitle} (${mergeResult.taskId})`;

            // Auto-hide status bar item after 3 seconds
            setTimeout(() => {
              statusBarItem?.dispose();
            }, 3000);

            vscode.window.showInformationMessage(
              `Task merged successfully! "${mergeResult.taskTitle}" (ID: ${mergeResult.taskId})`
            );
          } else {
            statusBarItem.text = `$(error) Task merge failed`;
            statusBarItem.tooltip = `Error: ${mergeResult.error}`;

            setTimeout(() => {
              statusBarItem?.dispose();
            }, 5000);

            vscode.window.showErrorMessage(
              `Failed to merge task: ${mergeResult.error}`
            );
          }

          tasksWebviewProvider.refresh();
        } catch (error) {
          // Update status bar to show error
          if (statusBarItem) {
            statusBarItem.text = '$(error) Task merge failed';
            statusBarItem.tooltip = `Error: ${error}`;
            setTimeout(() => {
              statusBarItem?.dispose();
            }, 5000);
          }

          vscode.window.showErrorMessage(`Failed to merge task: ${error}`);
        }
      } catch (error) {
        console.error('Error in inspectTask command:', error);
        vscode.window.showErrorMessage(`Failed to merge: ${error}`);
      }
    }
  );
  context.subscriptions.push(mergeTaskCommand);

  // Register the delete task command
  const deleteTaskCommand = vscode.commands.registerCommand(
    'rover.deleteTask',
    async (item: TaskItem | any) => {
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

        telemetry?.eventDeleteTask();

        const answer = await vscode.window.showWarningMessage(
          `Are you sure you want to delete task "${taskTitle}"?`,
          'Yes',
          'No'
        );

        if (answer === 'Yes') {
          await cli.deleteTask(taskId);
          vscode.window.showInformationMessage('Task deleted successfully!');
          tasksWebviewProvider.refresh();
        }
      } catch (error) {
        console.error('Error in deleteTask command:', error);
        vscode.window.showErrorMessage(`Failed to delete task: ${error}`);
      }
    }
  );
  context.subscriptions.push(deleteTaskCommand);

  // Register the shell command
  const shellCommand = vscode.commands.registerCommand(
    'rover.shell',
    (item: TaskItem | any) => {
      try {
        const taskId = item?.task?.id || item?.id;
        if (!taskId) {
          throw new Error('Invalid task item - missing task ID');
        }
        telemetry?.eventShell();

        cli.startShell(taskId);
      } catch (error) {
        console.error('Error in shell command:', error);
        vscode.window.showErrorMessage(`Failed to open shell: ${error}`);
      }
    }
  );
  context.subscriptions.push(shellCommand);

  // Register the logs command
  const logsCommand = vscode.commands.registerCommand(
    'rover.logs',
    async (item: TaskItem | any) => {
      try {
        const taskId = item?.task?.id || item?.id;
        const taskStatus = item?.task?.status || item?.status;

        if (!taskId) {
          throw new Error('Invalid task item - missing task ID');
        }

        telemetry?.eventLogs();

        // Only follow logs for running tasks
        const shouldFollow = ['running', 'initializing', 'installing'].includes(
          taskStatus
        );
        await cli.showLogs(taskId, shouldFollow);
      } catch (error) {
        console.error('Error in logs command:', error);
        vscode.window.showErrorMessage(`Failed to show logs: ${error}`);
      }
    }
  );
  context.subscriptions.push(logsCommand);

  // Register the open workspace command
  const openWorkspaceCommand = vscode.commands.registerCommand(
    'rover.openWorkspace',
    async (item: TaskItem | any) => {
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
          vscode.window.showWarningMessage(
            `Task workspace directory does not exist: ${workspacePath}`
          );
          return;
        }

        // Open the workspace in a new window
        const success = await vscode.commands.executeCommand(
          'vscode.openFolder',
          workspaceUri,
          {
            forceNewWindow: true,
          }
        );

        telemetry?.eventOpenWorkspace();

        if (success) {
          vscode.window.showInformationMessage(
            `Opened workspace for task: ${taskTitle}`
          );
        }
      } catch (error) {
        console.error('Error in openWorkspace command:', error);
        vscode.window.showErrorMessage(`Failed to open workspace: ${error}`);
      }
    }
  );
  context.subscriptions.push(openWorkspaceCommand);

  // Register the create task from GitHub command
  const createTaskFromGitHubCommand = vscode.commands.registerCommand(
    'rover.createTaskFromGitHub',
    async () => {
      let statusBarItem: vscode.StatusBarItem | undefined;

      try {
        // Create status bar item for loading indication
        statusBarItem = vscode.window.createStatusBarItem(
          vscode.StatusBarAlignment.Left,
          100
        );
        statusBarItem.text = '$(loading~spin) Fetching GitHub issues...';
        statusBarItem.show();

        // Try to get GitHub issues
        const issues = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Fetching GitHub Issues',
            cancellable: true,
          },
          async (progress, token) => {
            progress.report({
              increment: 0,
              message: 'Detecting repository...',
            });

            // Try to get repository info from git remote
            let repoInfo: { owner: string; repo: string } | null = null;
            try {
              const workspaceRoot =
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
                process.cwd();
              const { stdout: remoteUrl } = launchSync(
                'git',
                ['remote', 'get-url', 'origin'],
                { cwd: workspaceRoot }
              );
              const match = remoteUrl
                ? remoteUrl
                    .toString()
                    .match(/github\.com[:/]([^/]+)\/([^/.]+)(\.git)?/)
                : null;
              if (match) {
                repoInfo = { owner: match[1], repo: match[2] };
              }
            } catch (error) {
              console.warn('Failed to get git remote:', error);
            }

            if (!repoInfo) {
              return null;
            }

            if (token.isCancellationRequested) {
              return null;
            }

            progress.report({ increment: 30, message: 'Fetching issues...' });

            // Try GitHub API first (for public repos)
            try {
              const apiUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/issues?state=open&per_page=100`;
              const response = await fetch(apiUrl);

              if (response.ok) {
                const issues = (await response.json()) as any[];
                // Filter out pull requests (they also appear in issues API)
                return issues.filter((issue: any) => !issue.pull_request);
              }
            } catch (error) {
              console.warn('GitHub API failed:', error);
            }

            if (token.isCancellationRequested) {
              return null;
            }

            progress.report({ increment: 60, message: 'Trying GitHub CLI...' });

            // Fall back to gh CLI
            try {
              const workspaceRoot =
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
                process.cwd();
              const { stdout } = launchSync(
                'gh',
                [
                  'issue',
                  'list',
                  '--json',
                  'number,title,assignees,labels',
                  '--limit',
                  '100',
                ],
                { cwd: workspaceRoot }
              );
              return stdout ? JSON.parse(stdout.toString()) : null;
            } catch (error) {
              console.warn('GitHub CLI failed:', error);
              return null;
            }
          }
        );

        statusBarItem.dispose();
        statusBarItem = undefined;

        let issueNumber: string | undefined;

        if (issues && issues.length > 0) {
          // Show picker with issues
          const quickPickItems = issues.map((issue: any) => {
            const assignees =
              issue.assignees?.map((a: any) => a.login || a).join(', ') ||
              'Unassigned';
            const labels =
              issue.labels?.map((l: any) => l.name || l).join(', ') || '';

            return {
              label: `#${issue.number}: ${issue.title}`,
              description: assignees,
              detail: labels ? `Labels: ${labels}` : undefined,
              issueNumber: issue.number.toString(),
            };
          });

          const selected = await vscode.window.showQuickPick<any>(
            quickPickItems,
            {
              placeHolder: 'Select a GitHub issue to create a task from',
              ignoreFocusOut: true,
            }
          );

          if (selected) {
            issueNumber = selected.issueNumber;
          }
        } else {
          // Fall back to input box
          issueNumber = await vscode.window.showInputBox({
            prompt: 'Enter GitHub issue number',
            placeHolder: 'e.g., 123',
            ignoreFocusOut: true,
            validateInput: value => {
              if (!value || !value.match(/^\d+$/)) {
                return 'Please enter a valid issue number';
              }
              return null;
            },
          });
        }

        if (issueNumber) {
          // Create status bar for task creation
          statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
          );
          statusBarItem.text =
            '$(loading~spin) Creating task from GitHub issue...';
          statusBarItem.show();

          const createdTask = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Creating Task from GitHub Issue',
              cancellable: false,
            },
            async progress => {
              progress.report({ increment: 50, message: 'Creating task...' });

              // Create task with --from-github flag
              const roverPath =
                vscode.workspace
                  .getConfiguration('rover')
                  .get<string>('cliPath') || 'rover';
              const workspaceRoot =
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
                process.cwd();

              telemetry?.eventNewTask(NewTaskProvider.GITHUB);

              const { stdout } = launchSync(
                roverPath,
                [
                  'task',
                  '--from-github',
                  issueNumber.toString(),
                  '--yes',
                  '--json',
                ],
                { cwd: workspaceRoot }
              );
              return stdout ? JSON.parse(stdout.toString()) : null;
            }
          );

          statusBarItem.text = '$(check) Task created from GitHub issue';
          setTimeout(() => statusBarItem?.dispose(), 3000);

          vscode.window.showInformationMessage(
            `Task created successfully! "${createdTask.title}" (ID: ${createdTask.id})`
          );
          tasksWebviewProvider.refresh();
        }
      } catch (error) {
        if (statusBarItem) {
          statusBarItem.text = '$(error) Failed to create task';
          setTimeout(() => statusBarItem?.dispose(), 5000);
        }
        vscode.window.showErrorMessage(
          `Failed to create task from GitHub: ${error}`
        );
      }
    }
  );
  context.subscriptions.push(createTaskFromGitHubCommand);

  const runCommandInTerminal = ({
    terminalTitle,
    command,
    errorMessage,
    autoExecute = true,
  }: {
    terminalTitle: string;
    command: string;
    errorMessage: string;
    autoExecute?: boolean;
  }) => {
    try {
      const terminal = vscode.window.createTerminal({
        name: terminalTitle,
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      });

      terminal.show();
      terminal.sendText(command, autoExecute);
    } catch (error) {
      vscode.window.showErrorMessage(`${errorMessage}: ${error}`);
    }
  };

  // Register the install CLI command
  const installCommand = vscode.commands.registerCommand(
    'rover.install',
    async () => {
      runCommandInTerminal({
        terminalTitle: 'Rover Installation',
        command: 'npm install -g @endorhq/rover',
        errorMessage: 'Could not install Rover',
      });
    }
  );
  context.subscriptions.push(installCommand);

  // Register the initialize Rover command
  const initCommand = vscode.commands.registerCommand(
    'rover.init',
    async () => {
      runCommandInTerminal({
        terminalTitle: 'Rover Initialization',
        command: 'rover init',
        errorMessage:
          'Terminal tried to execute "rover init", but it failed; could not initialize rover in this directory',
      });
    }
  );
  context.subscriptions.push(initCommand);

  // Register the show setup guide command
  const showSetupGuideCommand = vscode.commands.registerCommand(
    'rover.showSetupGuide',
    async () => {
      // Focus the rover view
      await vscode.commands.executeCommand('workbench.view.extension.rover');
      // Force refresh to show current initialization status
      tasksWebviewProvider.refresh();
    }
  );
  context.subscriptions.push(showSetupGuideCommand);

  // Clean up the tree provider when extension is deactivated
  context.subscriptions.push({
    dispose: () => {
      tasksWebviewProvider.dispose();
    },
  });
}

export function deactivate() {
  if (tasksWebviewProvider) {
    tasksWebviewProvider.dispose();
  }
}
