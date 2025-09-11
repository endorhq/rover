// This file is specifically designed to be bundled for webview consumption
import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import styles from './tasks-webview.css.mjs';
import './components/tasks-intro.mjs';
import './components/initialization-guide.mjs';

declare global {
  interface Window {
    acquireVsCodeApi?: () => any;
  }
}

@customElement('tasks-webview')
export class TasksWebview extends LitElement {
  @property({ type: Object }) vscode: any = null;
  @state() private tasks: any[] = [];
  @state() private loading = true;
  @state() private taskInput = '';
  @state() private creatingTask = false;
  @state() private initializationStatus: any = null;
  @state() private showingSetupGuide = false;
  @state() private initializationCheckInterval: number | null = null;

  // Component styles
  static styles = styles;

  connectedCallback() {
    super.connectedCallback();
    if (this.vscode) {
      window.addEventListener('message', this.handleMessage.bind(this));
      window.addEventListener('keydown', this.handleKeyDown.bind(this));
      this.vscode.postMessage({ command: 'checkInitialization' });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('message', this.handleMessage.bind(this));
    window.removeEventListener('keydown', this.handleKeyDown.bind(this));
    this.stopInitializationPolling();
  }

  private handleMessage(event: MessageEvent) {
    const message = event.data;
    switch (message.command) {
      case 'updateTasks':
        this.tasks = message.tasks || [];
        this.loading = false;
        break;
      case 'updateInitializationStatus':
        this.initializationStatus = message.status;
        this.showingSetupGuide =
          !message.status.cliInstalled || !message.status.roverInitialized;

        // Start polling for rover initialization if CLI is installed but rover is not initialized
        if (message.status.cliInstalled && !message.status.roverInitialized) {
          this.startInitializationPolling();
        } else {
          this.stopInitializationPolling();
        }

        // Only stop loading if we already know we need to show the setup
        if (this.showingSetupGuide) {
          this.loading = false;
        }

        if (message.status.cliInstalled && message.status.roverInitialized) {
          this.vscode.postMessage({ command: 'refreshTasks' });
        }
        break;
      case 'roverInitializationChecked':
        // Update the rover initialization status based on file system check
        if (message.isInitialized && this.initializationStatus) {
          this.initializationStatus = {
            ...this.initializationStatus,
            roverInitialized: true,
          };
          this.showingSetupGuide = false;
          this.stopInitializationPolling();
          this.vscode.postMessage({ command: 'refreshTasks' });
        }
        break;
    }
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'Enter') {
      const textarea = this.shadowRoot?.querySelector(
        '.form-textarea'
      ) as HTMLTextAreaElement;
      if (textarea === event.target) {
        this.createTask();
      }
    }
  }

  private createTask() {
    const description = this.taskInput.trim();

    if (!description) {
      return;
    }

    this.creatingTask = true;

    if (this.vscode) {
      this.vscode.postMessage({
        command: 'createTask',
        description: description,
      });
    }

    // Reset form after a short delay
    setTimeout(() => {
      this.taskInput = '';
      this.creatingTask = false;
    }, 1000);
  }

  private inspectTask(taskId: string, taskTitle: string) {
    if (this.vscode) {
      this.vscode.postMessage({
        command: 'inspectTask',
        taskId: taskId,
        taskTitle: taskTitle,
      });
    }
  }

  private executeTaskAction(
    event: Event,
    action: string,
    taskId: string,
    taskTitle?: string,
    taskStatus?: string
  ) {
    event.stopPropagation();

    if (this.vscode) {
      const message: any = {
        command: action,
        taskId: taskId,
      };

      if (taskTitle) {
        message.taskTitle = taskTitle;
      }

      if (taskStatus) {
        message.taskStatus = taskStatus;
      }

      this.vscode.postMessage(message);
    }
  }

  private handleInstallCLI(event: Event) {
    if (this.vscode) {
      this.vscode.postMessage({
        command: 'installCLI',
      });
    }
  }

  private handleInitializeRover(event: Event) {
    if (this.vscode) {
      this.vscode.postMessage({
        command: 'initializeRover',
      });
    }
  }

  private handleRetryCheck(event: Event) {
    if (this.vscode) {
      this.vscode.postMessage({
        command: 'checkInitialization',
      });
    }
  }

  private getStatusIcon(status?: string): string {
    switch (status) {
      case 'COMPLETED':
      case 'MERGED':
      case 'PUSHED':
        return 'codicon-pass success';
      case 'FAILED':
        return 'codicon-error failed';
      case 'RUNNING':
        return 'codicon-play-circle running';
      case 'INITIALIZING':
        return 'codicon-play-circle running';
      case 'INSTALLING':
        return 'codicon-desktop-download running';
      default:
        return 'codicon-circle';
    }
  }

  private formatTimeInfo(task: any): string {
    if (task.completedAt) {
      const completed = new Date(task.completedAt);
      return `Completed ${this.formatRelativeTime(completed)}`;
    }

    if (
      task.status === 'RUNNING' ||
      task.status === 'INITIALIZING' ||
      task.status === 'INSTALLING'
    ) {
      const started = new Date(task.startedAt);
      return `Started ${this.formatRelativeTime(started)}`;
    }

    if (task.status === 'FAILED') {
      const started = new Date(task.startedAt);
      return `Failed after ${this.formatDuration(started)}`;
    }

    return '';
  }

  private formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  private formatDuration(startDate: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - startDate.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 60) return `${diffMins}m`;
    const remainingMins = diffMins % 60;
    return remainingMins > 0
      ? `${diffHours}h ${remainingMins}m`
      : `${diffHours}h`;
  }

  private startInitializationPolling() {
    // Only start polling if not already running
    if (this.initializationCheckInterval !== null) {
      return;
    }

    // Poll every 2 seconds for rover initialization
    this.initializationCheckInterval = window.setInterval(() => {
      if (this.vscode) {
        this.vscode.postMessage({ command: 'checkRoverInitialization' });
      }
    }, 2000);
  }

  private stopInitializationPolling() {
    if (this.initializationCheckInterval !== null) {
      window.clearInterval(this.initializationCheckInterval);
      this.initializationCheckInterval = null;
    }
  }

  render() {
    // Show initialization guide if CLI not installed or Rover not initialized
    if (this.showingSetupGuide && this.initializationStatus) {
      return html`
        <initialization-guide
          @install-cli=${this.handleInstallCLI}
          @initialize-rover=${this.handleInitializeRover}
          @retry-check=${this.handleRetryCheck}
          .status=${this.initializationStatus}
        ></initialization-guide>
      `;
    }

    return html`
      <div class="tasks-container">
        ${this.loading
          ? html` <div class="empty-state">Loading tasks...</div> `
          : this.tasks.length === 0
            ? html` <tasks-intro></tasks-intro> `
            : this.tasks.map(task => {
                const timeInfo = this.formatTimeInfo(task);
                const details = [task.status.toUpperCase()];

                if (timeInfo) details.push(timeInfo);
                if (task.progress !== undefined && task.progress > 0)
                  details.push(`${task.progress}%`);
                if (task.currentStep && task.status === 'RUNNING')
                  details.push(`Step: ${task.currentStep}`);

                const isRunning = [
                  'RUNNING',
                  'INITIALIZING',
                  'INSTALLING',
                ].includes(task.status?.toLowerCase());
                const isCompleted = ['COMPLETED', 'MERGED', 'PUSHED'].includes(
                  task.status?.toLowerCase()
                );

                return html`
                  <div
                    class="task-item"
                    @click=${() => this.inspectTask(task.id, task.title)}
                  >
                    <div class="task-icon">
                      <i class="codicon ${this.getStatusIcon(task.status)}"></i>
                    </div>
                    <div class="task-content">
                      <div class="task-title">${task.title}</div>
                      <div class="task-details">${details.join(' • ')}</div>
                    </div>
                    <div class="task-actions">
                      ${isCompleted
                        ? html`
                            <button
                              class="action-btn"
                              @click=${(e: Event) =>
                                this.executeTaskAction(
                                  e,
                                  'gitCompare',
                                  task.id
                                )}
                              title="Compare Task Changes"
                            >
                              <i class="codicon codicon-diff-multiple"></i>
                            </button>
                            <button
                              class="action-btn"
                              @click=${(e: Event) =>
                                this.executeTaskAction(
                                  e,
                                  'iterateTask',
                                  task.id
                                )}
                              title="Iterate Task"
                            >
                              <i class="codicon codicon-debug-rerun"></i>
                            </button>
                            <button
                              class="action-btn"
                              @click=${(e: Event) =>
                                this.executeTaskAction(e, 'mergeTask', task.id)}
                              title="Merge Task"
                            >
                              <i class="codicon codicon-git-merge"></i>
                            </button>
                            <button
                              class="action-btn"
                              @click=${(e: Event) =>
                                this.executeTaskAction(
                                  e,
                                  'pushBranch',
                                  task.id
                                )}
                              title="Push Task Branch"
                            >
                              <i class="codicon codicon-repo-push"></i>
                            </button>
                          `
                        : ''}
                      <button
                        class="action-btn"
                        @click=${(e: Event) =>
                          this.executeTaskAction(
                            e,
                            'viewLogs',
                            task.id,
                            undefined,
                            task.status
                          )}
                        title="View Logs"
                      >
                        <i class="codicon codicon-file"></i>
                      </button>
                      ${isRunning || isCompleted
                        ? html`
                            <button
                              class="action-btn"
                              @click=${(e: Event) =>
                                this.executeTaskAction(e, 'openShell', task.id)}
                              title="Open Shell"
                            >
                              <i class="codicon codicon-terminal"></i>
                            </button>
                          `
                        : ''}
                      <button
                        class="action-btn"
                        @click=${(e: Event) =>
                          this.executeTaskAction(e, 'openWorkspace', task.id)}
                        title="Open Workspace"
                      >
                        <i class="codicon codicon-folder"></i>
                      </button>
                      <button
                        class="action-btn"
                        @click=${(e: Event) =>
                          this.executeTaskAction(
                            e,
                            'deleteTask',
                            task.id,
                            task.title
                          )}
                        title="Delete Task"
                      >
                        <i class="codicon codicon-trash"></i>
                      </button>
                    </div>
                  </div>
                `;
              })}
      </div>

      <div class="create-form">
        <textarea
          class="form-textarea"
          placeholder="Describe what you want Rover to accomplish..."
          .value=${this.taskInput}
          @input=${(e: InputEvent) =>
            (this.taskInput = (e.target as HTMLTextAreaElement).value)}
        ></textarea>
        <button
          class="form-button"
          @click=${this.createTask}
          ?disabled=${this.creatingTask}
        >
          ${this.creatingTask ? 'Creating...' : 'Create Task'}
        </button>
      </div>
    `;
  }
}

// Initialize the component when the DOM is ready
if (typeof window !== 'undefined') {
  // Acquire VS Code API
  const vscode =
    typeof window.acquireVsCodeApi !== 'undefined'
      ? window.acquireVsCodeApi()
      : null;

  // Create and configure the component
  const component = document.createElement('tasks-webview');

  // Set VS Code API
  if (vscode) {
    (component as any).vscode = vscode;
  }

  // Mount the component when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.appendChild(component);
    });
  } else {
    document.body.appendChild(component);
  }
}
