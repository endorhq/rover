import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RoverCLI } from '../rover/cli';
import { RoverTask } from '../rover/types';

export class TasksWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'roverTasks';

    private _view?: vscode.WebviewView;
    private cli: RoverCLI;
    private autoRefreshInterval: NodeJS.Timeout | undefined;

    constructor(private readonly _extensionUri: vscode.Uri) {
        this.cli = new RoverCLI();
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
                vscode.Uri.joinPath(this._extensionUri, 'dist'),
                vscode.Uri.joinPath(this._extensionUri, 'src')
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
                case 'inspectTask':
                    await this.handleInspectTask(data.taskId, data.taskTitle);
                    break;
                case 'deleteTask':
                    await this.handleDeleteTask(data.taskId);
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
            }
        });

        // Start auto-refresh
        this.startAutoRefresh();

        // Load initial tasks
        this.refreshTasks();
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

    private async handleDeleteTask(taskId: string) {
        await vscode.commands.executeCommand('rover.deleteTask', { id: taskId, task: { id: taskId } });
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

    private _getHtmlForWebview(webview: vscode.Webview) {
        try {
            const templateContent = this._getTemplateContent();
            return templateContent;
        } catch (error) {
            console.error('Error loading template, using inline fallback:', error);
            return this._getInlineTasksTemplate();
        }
    }

    private _getTemplateContent(): string {
        // Try to read from the copied template file in the dist directory
        const distTemplatePath = path.join(__dirname, 'panels', 'tasksWithFormTemplate.html');
        if (fs.existsSync(distTemplatePath)) {
            return fs.readFileSync(distTemplatePath, 'utf8');
        }

        // Try alternative paths for different build scenarios
        const altPaths = [
            path.join(__dirname, 'tasksWithFormTemplate.html'),
            path.join(__dirname, '..', 'panels', 'tasksWithFormTemplate.html'),
            path.join(__dirname, '..', '..', 'src', 'panels', 'tasksWithFormTemplate.html'),
            path.resolve(__dirname, '..', '..', 'src', 'panels', 'tasksWithFormTemplate.html')
        ];

        for (const altPath of altPaths) {
            if (fs.existsSync(altPath)) {
                return fs.readFileSync(altPath, 'utf8');
            }
        }

        throw new Error('Template file not found in any expected location');
    }

    private _getInlineTasksTemplate(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rover Tasks</title>
    <style>
        :root {
            --vscode-font-family: var(--vscode-font-family);
        }

        body {
            font-family: var(--vscode-font-family);
            margin: 0;
            padding: 8px;
            background-color: var(--vscode-sideBar-background);
            color: var(--vscode-sideBar-foreground);
            font-size: 13px;
            height: calc(100vh - 25px);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .tasks-container {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            margin-bottom: 8px;
            min-height: 0;
        }

        .task-item {
            padding: 8px;
            border-bottom: 1px solid var(--vscode-sideBar-border);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .task-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .task-icon {
            flex-shrink: 0;
        }

        .task-content {
            flex: 1;
            min-width: 0;
        }

        .task-title {
            font-weight: 500;
            margin-bottom: 2px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .task-details {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .task-actions {
            display: flex;
            gap: 4px;
            opacity: 0;
            transition: opacity 0.2s;
        }

        .task-item:hover .task-actions {
            opacity: 1;
        }

        .action-btn {
            background: none;
            border: none;
            color: var(--vscode-button-foreground);
            cursor: pointer;
            padding: 2px;
            border-radius: 2px;
            font-size: 12px;
        }

        .action-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .create-form {
            border-top: 1px solid var(--vscode-sideBar-border);
            padding: 8px 0 0 0;
            background-color: var(--vscode-sideBar-background);
            flex-shrink: 0;
        }

        .form-textarea {
            width: 100%;
            min-height: 60px;
            padding: 6px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-font-family);
            font-size: 12px;
            resize: vertical;
            box-sizing: border-box;
            margin-bottom: 6px;
        }

        .form-textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .form-textarea::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        .form-button {
            width: 100%;
            padding: 6px 12px;
            border: none;
            border-radius: 3px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-family: var(--vscode-font-family);
            font-size: 12px;
            cursor: pointer;
        }

        .form-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .form-button:disabled {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: not-allowed;
            opacity: 0.6;
        }

        .empty-state {
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }

        .status-badge {
            padding: 1px 4px;
            border-radius: 8px;
            font-size: 9px;
            font-weight: 600;
            text-transform: uppercase;
        }

        .status-completed { background-color: var(--vscode-testing-iconPassed); color: white; }
        .status-failed { background-color: var(--vscode-testing-iconFailed); color: white; }
        .status-running { background-color: var(--vscode-testing-iconQueued); color: white; }
        .status-new { background-color: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    </style>
</head>
<body>
    <div class="tasks-container" id="tasksContainer">
        <div class="empty-state" id="emptyState">Loading tasks...</div>
    </div>
    
    <div class="create-form">
        <textarea 
            id="taskInput" 
            class="form-textarea" 
            placeholder="Describe what you want Rover to accomplish..."
        ></textarea>
        <button id="createButton" class="form-button" onclick="createTask()">Create Task</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let tasks = [];

        function createTask() {
            const input = document.getElementById('taskInput');
            const description = input.value.trim();
            
            if (!description) {
                input.focus();
                return;
            }

            const createButton = document.getElementById('createButton');
            createButton.disabled = true;
            createButton.textContent = 'Creating...';

            vscode.postMessage({
                command: 'createTask',
                description: description
            });

            // Reset form after a short delay
            setTimeout(() => {
                input.value = '';
                createButton.disabled = false;
                createButton.textContent = 'Create Task';
            }, 1000);
        }

        function getStatusClass(status) {
            switch (status?.toLowerCase()) {
                case 'completed': return 'status-completed';
                case 'failed': return 'status-failed';
                case 'running': case 'initializing': case 'installing': return 'status-running';
                default: return 'status-new';
            }
        }

        function getStatusIcon(status) {
            switch (status?.toLowerCase()) {
                case 'completed': return '✅';
                case 'failed': return '❌';
                case 'running': return '🔄';
                case 'initializing': return '⚡';
                case 'installing': return '📦';
                default: return '⚪';
            }
        }

        function formatTimeInfo(task) {
            if (task.completedAt) {
                const completed = new Date(task.completedAt);
                return \`Completed \${formatRelativeTime(completed)}\`;
            }
            
            if (task.status === 'running' || task.status === 'initializing' || task.status === 'installing') {
                const started = new Date(task.startedAt);
                return \`Started \${formatRelativeTime(started)}\`;
            }
            
            if (task.status === 'failed') {
                const started = new Date(task.startedAt);
                return \`Failed after \${formatDuration(started)}\`;
            }
            
            return '';
        }

        function formatRelativeTime(date) {
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffMins = Math.floor(diffMs / (1000 * 60));
            const diffHours = Math.floor(diffMins / 60);
            const diffDays = Math.floor(diffHours / 24);

            if (diffMins < 1) return 'just now';
            if (diffMins < 60) return \`\${diffMins}m ago\`;
            if (diffHours < 24) return \`\${diffHours}h ago\`;
            if (diffDays === 1) return 'yesterday';
            if (diffDays < 7) return \`\${diffDays}d ago\`;
            return date.toLocaleDateString();
        }

        function formatDuration(startDate) {
            const now = new Date();
            const diffMs = now.getTime() - startDate.getTime();
            const diffMins = Math.floor(diffMs / (1000 * 60));
            const diffHours = Math.floor(diffMins / 60);

            if (diffMins < 60) return \`\${diffMins}m\`;
            const remainingMins = diffMins % 60;
            return remainingMins > 0 ? \`\${diffHours}h \${remainingMins}m\` : \`\${diffHours}h\`;
        }

        function inspectTask(taskId, taskTitle) {
            vscode.postMessage({
                command: 'inspectTask',
                taskId: taskId,
                taskTitle: taskTitle
            });
        }

        function deleteTask(taskId) {
            vscode.postMessage({
                command: 'deleteTask',
                taskId: taskId
            });
        }

        function openShell(taskId) {
            vscode.postMessage({
                command: 'openShell',
                taskId: taskId
            });
        }

        function viewLogs(taskId, taskStatus) {
            vscode.postMessage({
                command: 'viewLogs',
                taskId: taskId,
                taskStatus: taskStatus
            });
        }

        function openWorkspace(taskId) {
            vscode.postMessage({
                command: 'openWorkspace',
                taskId: taskId
            });
        }

        function renderTasks(taskList) {
            tasks = taskList;
            const container = document.getElementById('tasksContainer');
            const emptyState = document.getElementById('emptyState');

            if (!taskList || taskList.length === 0) {
                emptyState.textContent = 'No tasks found. Create your first task below!';
                emptyState.style.display = 'block';
                return;
            }

            emptyState.style.display = 'none';
            
            container.innerHTML = taskList.map(task => {
                const timeInfo = formatTimeInfo(task);
                const details = [task.status.toUpperCase()];
                
                if (timeInfo) details.push(timeInfo);
                if (task.progress !== undefined && task.progress > 0) details.push(\`\${task.progress}%\`);
                if (task.currentStep && task.status === 'running') details.push(\`Step: \${task.currentStep}\`);

                return \`
                    <div class="task-item" onclick="inspectTask('\${task.id}', '\${task.title}')">
                        <div class="task-icon">\${getStatusIcon(task.status)}</div>
                        <div class="task-content">
                            <div class="task-title">\${task.title}</div>
                            <div class="task-details">\${details.join(' • ')}</div>
                        </div>
                        <div class="task-actions">
                            <button class="action-btn" onclick="event.stopPropagation(); viewLogs('\${task.id}', '\${task.status}')" title="View Logs">📄</button>
                            \${['running', 'initializing', 'installing'].includes(task.status) ? 
                                \`<button class="action-btn" onclick="event.stopPropagation(); openShell('\${task.id}')" title="Open Shell">💻</button>\` : ''
                            }
                            <button class="action-btn" onclick="event.stopPropagation(); openWorkspace('\${task.id}')" title="Open Workspace">📁</button>
                            <button class="action-btn" onclick="event.stopPropagation(); deleteTask('\${task.id}')" title="Delete Task">🗑️</button>
                        </div>
                    </div>
                \`;
            }).join('');
        }

        // Handle messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'updateTasks':
                    renderTasks(message.tasks);
                    break;
            }
        });

        // Handle keyboard shortcuts
        document.getElementById('taskInput').addEventListener('keydown', function(e) {
            if (e.ctrlKey && e.key === 'Enter') {
                createTask();
            }
        });

        // Request initial tasks
        vscode.postMessage({ command: 'refreshTasks' });
    </script>
</body>
</html>`;
    }
}