// This file is specifically designed to be bundled for webview consumption
import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import styles from './tasks-webview.css.mjs';
import './components/tasks-intro.mjs';
import './components/initialization-guide.mjs';
import './components/task-card.mjs';

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

  private handleInspectTask(event: CustomEvent) {
    const { taskId, taskTitle } = event.detail;
    if (this.vscode) {
      this.vscode.postMessage({
        command: 'inspectTask',
        taskId: taskId,
        taskTitle: taskTitle,
      });
    }
  }

  private handleTaskAction(event: CustomEvent) {
    const { action, taskId, taskTitle, taskStatus } = event.detail;
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
          ? html`
              <div class="loading-state">
                <div class="loading-spinner">
                  <i class="codicon codicon-loading spinner-icon"></i>
                </div>
                <div class="loading-text">Loading tasks...</div>
                <div class="loading-subtext">
                  Please wait while we fetch your tasks
                </div>
              </div>
            `
          : this.tasks.length === 0
            ? html` <tasks-intro></tasks-intro> `
            : this.tasks.map(
                task => html`
                  <task-card
                    .task=${task}
                    @inspect-task=${this.handleInspectTask}
                    @task-action=${this.handleTaskAction}
                  ></task-card>
                `
              )}
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
