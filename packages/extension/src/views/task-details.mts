// This file is specifically designed to be bundled for webview consumption
import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import styles from './task-details.css.mjs';
import './components/dropdown-button.mjs';
import type { DropdownAction } from './components/dropdown-button.mjs';

declare global {
  interface Window {
    acquireVsCodeApi?: () => any;
  }
}

@customElement('task-details-view')
export class TaskDetailsView extends LitElement {
  @property({ type: Object }) taskData: any = null;
  @property({ type: Object }) vscode: any = null;
  @state() private loading = true;
  @state() private error: string | null = null;
  @state() private expandedSections = new Set(['iterations']);
  @state() private activeTab = 'summary';

  static styles = styles;

  connectedCallback() {
    super.connectedCallback();
    if (this.vscode) {
      window.addEventListener('message', this.handleMessage.bind(this));
      this.vscode.postMessage({ command: 'ready' });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('message', this.handleMessage.bind(this));
  }

  private handleMessage(event: MessageEvent) {
    const message = event.data;
    switch (message.command) {
      case 'updateTaskData':
        this.taskData = message.data;
        this.loading = false;
        break;
      case 'showError':
        this.error = message.message;
        this.loading = false;
        break;
    }
  }

  private toggleSection(sectionId: string) {
    if (this.expandedSections.has(sectionId)) {
      this.expandedSections.delete(sectionId);
    } else {
      this.expandedSections.add(sectionId);
    }
    this.requestUpdate();
  }

  private toggleIteration(iterationId: string) {
    this.toggleSection(`iteration-${iterationId}`);
  }

  private openFile(filePath: string) {
    if (this.vscode) {
      this.vscode.postMessage({
        command: 'openFile',
        filePath: filePath,
      });
    }
  }

  private executeAction(action: string) {
    if (this.vscode) {
      this.vscode.postMessage({
        command: 'executeAction',
        action: action,
        taskId: this.taskData?.id,
      });
    }
  }

  private getDropdownActions(): DropdownAction[] {
    return [
      {
        action: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
      },
      {
        action: 'delete',
        label: 'Delete Task',
        icon: 'trash',
        danger: true,
      },
    ];
  }

  private handleDropdownAction(event: CustomEvent) {
    this.executeAction(event.detail.action);
  }

  private switchTab(tabId: string) {
    this.activeTab = tabId;
  }

  private getStatusClass(status?: string): string {
    switch (status?.toLowerCase()) {
      case 'completed':
        return 'status-completed';
      case 'merged':
        return 'status-merged';
      case 'pushed':
        return 'status-pushed';
      case 'failed':
        return 'status-failed';
      case 'in_progress':
      case 'running':
      case 'initializing':
      case 'installing':
        return 'status-running';
      default:
        return 'status-pending';
    }
  }

  private getStatusIcon(status?: string): string {
    switch (status?.toUpperCase()) {
      case 'COMPLETED':
        return 'codicon-pass';
      case 'MERGED':
        return 'codicon-git-merge';
      case 'PUSHED':
        return 'codicon-repo-push';
      case 'FAILED':
        return 'codicon-error';
      case 'RUNNING':
      case 'INITIALIZING':
        return 'codicon-sync~spin';
      case 'INSTALLING':
        return 'codicon-desktop-download';
      default:
        return 'codicon-circle-large-outline';
    }
  }

  private formatDate(dateString?: string): string {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString();
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

  render() {
    if (this.loading) {
      return html`
        <div class="loading">
          <div>Loading task details...</div>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div class="error">Error loading task details: ${this.error}</div>
      `;
    }

    if (!this.taskData) {
      return html`
        <div class="loading">
          <div>No task data available</div>
        </div>
      `;
    }

    const isRunning = ['running', 'in_progress'].includes(
      this.taskData.status?.toLowerCase()
    );
    const isCompleted = this.taskData.status?.toLowerCase() == 'completed';

    return html`
      <div class="header">
        <div class="header-main">
          <div class="header-title-block">
            <div class="title-row">
              <span class="header-id">#${this.taskData.id}</span>
              <h1 class="header-title">${this.taskData.title}</h1>
            </div>
            <div class="status-row">
              <span
                class="status-badge ${this.getStatusClass(
                  this.taskData.status
                )}"
              >
                <span
                  class="codicon ${this.getStatusIcon(this.taskData.status)}"
                ></span>
                ${this.taskData.formattedStatus ||
                this.taskData.status ||
                'Unknown'}
              </span>
              ${this.taskData.workflowName
                ? html`<span class="workflow-name"
                    >${this.taskData.workflowName}</span
                  >`
                : ''}
              <span class="time-info">
                ${this.taskData.createdAt
                  ? `Created ${this.formatRelativeTime(new Date(this.taskData.createdAt))}`
                  : ''}
                ${this.taskData.completedAt
                  ? ` • Completed ${this.formatRelativeTime(new Date(this.taskData.completedAt))}`
                  : ''}
                ${this.taskData.failedAt
                  ? ` • Failed ${this.formatRelativeTime(new Date(this.taskData.failedAt))}`
                  : ''}
              </span>
            </div>
          </div>
        </div>
        <div class="header-actions">
          <div class="action-buttons">
            <button
              class="action-button secondary"
              @click=${() => this.executeAction('logs')}
            >
              <span class="codicon codicon-output"></span>
              View Logs
            </button>
            <button
              class="action-button secondary"
              @click=${() => this.executeAction('shell')}
              ?disabled=${!isRunning && !isCompleted}
            >
              <span class="codicon codicon-terminal"></span>
              Open Shell
            </button>
            <button
              class="action-button secondary"
              @click=${() => this.executeAction('openWorkspace')}
            >
              <span class="codicon codicon-folder-opened"></span>
              Open Workspace
            </button>
            <dropdown-button
              .actions=${this.getDropdownActions()}
              buttonLabel="More"
              buttonIcon="kebab-vertical"
              title="More actions"
              @dropdown-action=${this.handleDropdownAction}
            ></dropdown-button>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <span class="codicon codicon-note"></span>
          <span>Description</span>
        </div>
        <div class="section-content">
          <div class="description">${this.taskData.description || '-'}</div>
        </div>
      </div>

      ${this.renderLatestSummary()}

      <div class="section">
        <div
          class="section-header ${this.expandedSections.has('iterations')
            ? 'expanded'
            : ''}"
          @click=${() => this.toggleSection('iterations')}
        >
          <span class="codicon codicon-chevron-right"></span>
          <span>Iterations</span>
        </div>
        <div
          class="section-content ${!this.expandedSections.has('iterations')
            ? 'collapsed'
            : ''}"
        >
          ${this.renderIterations()}
        </div>
      </div>
    `;
  }

  private renderLatestSummary() {
    if (!this.taskData.iterations || this.taskData.iterations.length === 0) {
      return '';
    }

    const latestIteration =
      this.taskData.iterations[this.taskData.iterations.length - 1];

    if (!latestIteration.files || latestIteration.files.length === 0) {
      return '';
    }

    // Create tabs array with summary and files
    const tabs: { id: string; label: string; icon: string; content: string }[] =
      [];

    // Add file tabs
    if (latestIteration.files && latestIteration.files.length > 0) {
      latestIteration.files.forEach((file: any) => {
        tabs.push({
          id: `file-${file.path}`,
          label: file.name || file.path.split('/').pop(),
          icon: 'file',
          content: file.content || null,
        });
      });
    }

    if (tabs.length === 0) {
      return '';
    }

    // Set default active tab if current active tab doesn't exist
    if (!tabs.some(tab => tab.id === this.activeTab)) {
      this.activeTab = tabs[0].id;
    }

    const activeTabData =
      tabs.find(tab => tab.id === this.activeTab) || tabs[0];

    return html`
      <div class="section">
        <div class="section-header">
          <span class="codicon codicon-book"></span>
          <span>Latest Iteration Files</span>
        </div>
        <div class="section-content">
          <p>
            These are the files that the AI Coding Agent generated while
            completing the task.
          </p>
          <div class="tabs-container">
            <div class="tab-bar">
              ${tabs.map(
                tab => html`
                  <button
                    class="tab ${this.activeTab === tab.id ? 'active' : ''}"
                    @click=${() => this.switchTab(tab.id)}
                    title=${tab.label}
                  >
                    <span class="codicon codicon-${tab.icon}"></span>
                    <span class="tab-label">${tab.label}</span>
                  </button>
                `
              )}
            </div>
            <div class="tab-content">
              ${this.renderTabContent(activeTabData)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderTabContent(tab: any) {
    if (!tab) {
      return html`<div class="tab-panel">No content available</div>`;
    }

    if (tab.id === 'summary') {
      return html`
        <div class="tab-panel">
          <div class="summary-content">${tab.content || '-'}</div>
        </div>
      `;
    }

    if (!tab.content) {
      return html`
        <div class="tab-panel">
          <div class="file-missing">
            <span class="codicon codicon-info"></span>
            <span>No content available for this file</span>
          </div>
        </div>
      `;
    }

    return html`
      <div class="tab-panel">
        <div class="file-content">
          <pre><code>${tab.content}</code></pre>
        </div>
      </div>
    `;
  }

  private renderIterations() {
    if (!this.taskData.iterations || this.taskData.iterations.length === 0) {
      return html`<div class="no-iterations">No iterations found</div>`;
    }

    return html`
      <div id="iterationsList">
        ${this.taskData.iterations.map((iteration: any, index: number) => {
          const iterationId = `${index}`;
          const isExpanded = !this.expandedSections.has(
            `iteration-${iterationId}`
          );

          return html`
            <div class="iteration">
              <div
                class="iteration-header ${isExpanded ? 'expanded' : ''}"
                @click=${() => this.toggleIteration(iterationId)}
              >
                <span class="codicon codicon-chevron-right"></span>
                <span class="iteration-title"
                  >Iteration ${iteration.number || index + 1}</span
                >
                <div class="iteration-meta">
                  <span
                    class="status-badge ${this.getStatusClass(
                      iteration.status
                    )}"
                  >
                    <span
                      class="codicon ${this.getStatusIcon(iteration.status)}"
                    ></span>
                    ${iteration.status || 'Unknown'}
                  </span>
                  ${iteration.startedAt
                    ? html`<span
                        >${this.formatRelativeTime(
                          new Date(iteration.startedAt)
                        )}</span
                      >`
                    : ''}
                </div>
              </div>
              <div class="iteration-content ${!isExpanded ? 'collapsed' : ''}">
                <div class="field-row">
                  <span class="field-label">Started:</span>
                  <span class="field-value"
                    >${this.formatDate(iteration.startedAt)}</span
                  >
                </div>
                ${iteration.completedAt
                  ? html`
                      <div class="field-row">
                        <span class="field-label">Completed:</span>
                        <span class="field-value"
                          >${this.formatDate(iteration.completedAt)}</span
                        >
                      </div>
                    `
                  : ''}
                <div class="field-row">
                  <span class="field-label">Files:</span>
                  <div class="field-value">
                    <div class="file-buttons">
                      ${iteration.files?.length
                        ? iteration.files.map(
                            (file: any) => html`
                              <button
                                class="file-button"
                                @click=${() => this.openFile(file.path)}
                                ?disabled=${!file.exists}
                              >
                                <span class="codicon codicon-file"></span>
                                ${file.name}
                              </button>
                            `
                          )
                        : html`<span
                            style="color: var(--vscode-descriptionForeground);"
                            >No files available</span
                          >`}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
        })}
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
  const component = document.createElement('task-details-view');

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
