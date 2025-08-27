// This file is specifically designed to be bundled for webview consumption
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

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

  static styles = css`
    :host {
      display: block;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      font-weight: var(--vscode-font-weight);
      padding: 20px;
      margin: 0;
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      line-height: 1.5;
    }

    .header {
      display: flex;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-widget-border);
    }

    .header-title {
      font-size: 14px;
      font-weight: 600;
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.9;
    }

    .section {
      margin-bottom: 12px;
      background: transparent;
      border: none;
      overflow: hidden;
    }

    .section-header {
      padding: 4px 0;
      margin-bottom: 8px;
      background: transparent;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.6;
      display: flex;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }

    .section-header:hover {
      opacity: 0.8;
    }

    .section-content {
      padding: 0;
      margin-left: 22px;
    }

    .section-content.collapsed {
      display: none;
    }

    .expand-icon {
      margin-left: auto;
      font-size: 10px;
      opacity: 0.6;
      transition: transform 0.2s ease;
    }

    .expand-icon.expanded {
      transform: rotate(90deg);
    }

    .field-row {
      display: flex;
      margin-bottom: 4px;
      align-items: baseline;
      font-size: 13px;
    }

    .field-label {
      min-width: 100px;
      margin-right: 8px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.9;
    }

    .field-value {
      flex: 1;
      color: var(--vscode-foreground);
    }

    .status-badge {
      padding: 2px 6px;
      border-radius: 2px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .status-completed {
      background-color: var(--vscode-testing-iconPassed);
      color: var(--vscode-editor-background);
    }

    .status-failed {
      background-color: var(--vscode-testing-iconFailed);
      color: var(--vscode-editor-background);
    }

    .status-running {
      background-color: var(--vscode-testing-iconQueued);
      color: var(--vscode-editor-background);
    }

    .status-new {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .description {
      background-color: var(--vscode-editor-inactiveSelectionBackground);
      border-left: 2px solid var(--vscode-focusBorder);
      padding: 8px 12px;
      margin: 4px 0 12px 0;
      font-size: 13px;
      line-height: 1.5;
      color: var(--vscode-foreground);
      opacity: 0.9;
    }

    .iteration {
      border: 1px solid var(--vscode-widget-border);
      border-radius: 3px;
      margin-bottom: 8px;
      overflow: hidden;
      background-color: var(--vscode-editor-inactiveSelectionBackground);
    }

    .iteration-header {
      padding: 8px 12px;
      background-color: transparent;
      display: flex;
      align-items: center;
      cursor: pointer;
      user-select: none;
      font-size: 13px;
    }

    .iteration-header:hover {
      background-color: var(--vscode-list-hoverBackground);
    }

    .iteration-title {
      font-weight: 500;
      margin-right: 12px;
    }

    .iteration-content {
      padding: 0 12px 12px 12px;
      border-top: 1px solid var(--vscode-widget-border);
    }

    .iteration-content.collapsed {
      display: none;
    }

    .file-buttons {
      display: flex;
      gap: 8px;
      margin-top: 8px;
      flex-wrap: wrap;
    }

    .file-button {
      background: transparent;
      color: var(--vscode-textLink-foreground);
      border: 1px solid transparent;
      padding: 2px 6px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      transition: all 0.1s ease;
      text-decoration: none;
    }

    .file-button:hover {
      text-decoration: underline;
      background-color: var(--vscode-list-hoverBackground);
    }

    .file-button:disabled {
      color: var(--vscode-disabledForeground);
      cursor: not-allowed;
      opacity: 0.6;
    }

    .file-button:disabled:hover {
      text-decoration: none;
      background: transparent;
    }

    .action-buttons {
      display: flex;
      gap: 12px;
      margin-top: 8px;
      flex-wrap: wrap;
    }

    .action-button {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 4px 14px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 400;
      display: inline-flex;
      align-items: center;
      transition: background-color 0.1s ease;
      outline: 1px solid transparent;
      outline-offset: 2px;
    }

    .action-button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }

    .action-button:focus {
      outline-color: var(--vscode-focusBorder);
    }

    .action-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .action-button.secondary {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .action-button.secondary:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }

    .loading {
      text-align: center;
      padding: 40px;
      color: var(--vscode-descriptionForeground);
    }

    .error {
      color: var(--vscode-errorForeground);
      background-color: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      padding: 12px;
      border-radius: 3px;
      margin: 12px 0;
    }

    .no-iterations {
      padding: 12px 0;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
      opacity: 0.8;
    }

    .summary-content {
      margin-top: 12px;
      padding: 12px;
      background-color: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 3px;
      font-size: 13px;
      line-height: 1.6;
      white-space: pre-wrap;
      font-family: var(--vscode-editor-font-family), monospace;
    }

    .summary-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.6;
      margin-bottom: 8px;
    }
  `;

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
        filePath: filePath
      });
    }
  }

  private executeAction(action: string) {
    if (this.vscode) {
      this.vscode.postMessage({
        command: 'executeAction',
        action: action,
        taskId: this.taskData?.id
      });
    }
  }

  private getStatusClass(status?: string): string {
    switch (status?.toLowerCase()) {
      case 'completed': return 'status-completed';
      case 'failed': return 'status-failed';
      case 'in_progress':
      case 'running': return 'status-running';
      default: return 'status-new';
    }
  }

  private formatDate(dateString?: string): string {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString();
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
        <div class="error">
          Error loading task details: ${this.error}
        </div>
      `;
    }

    if (!this.taskData) {
      return html`
        <div class="loading">
          <div>No task data available</div>
        </div>
      `;
    }

    const isRunning = ['running', 'in_progress'].includes(this.taskData.status?.toLowerCase());
    const isCompleted = this.taskData.status?.toLowerCase() == 'completed';

    return html`
      <div class="header">
        <h1 class="header-title">Task Details: ${this.taskData.title}</h1>
      </div>

      <div class="section">
        <div class="section-header">
          <span>Overview</span>
        </div>
        <div class="section-content">
          <div class="field-row">
            <span class="field-label">ID:</span>
            <span class="field-value">${this.taskData.id || '-'}</span>
          </div>
          <div class="field-row">
            <span class="field-label">Status:</span>
            <span class="field-value">
              <span class="status-badge ${this.getStatusClass(this.taskData.status)}">
                ${this.taskData.formattedStatus || this.taskData.status || '-'}
              </span>
            </span>
          </div>
          <div class="field-row">
            <span class="field-label">Created:</span>
            <span class="field-value">${this.formatDate(this.taskData.createdAt)}</span>
          </div>
          ${this.taskData.completedAt ? html`
            <div class="field-row">
              <span class="field-label">Completed:</span>
              <span class="field-value">${this.formatDate(this.taskData.completedAt)}</span>
            </div>
          ` : ''}
          ${this.taskData.failedAt ? html`
            <div class="field-row">
              <span class="field-label">Failed:</span>
              <span class="field-value">${this.formatDate(this.taskData.failedAt)}</span>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <span>Description</span>
        </div>
        <div class="section-content">
          <div class="description">${this.taskData.description || '-'}</div>
          ${this.renderLatestSummary()}
        </div>
      </div>

      <div class="section">
        <div class="section-header" @click=${() => this.toggleSection('iterations')}>
          <span>Iterations</span>
          <span class="expand-icon ${this.expandedSections.has('iterations') ? 'expanded' : ''}">▶</span>
        </div>
        <div class="section-content ${!this.expandedSections.has('iterations') ? 'collapsed' : ''}">
          ${this.renderIterations()}
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <span>Actions</span>
        </div>
        <div class="section-content">
          <div class="action-buttons">
            <button class="action-button secondary" @click=${() => this.executeAction('logs')}>
              View Logs
            </button>
            <button class="action-button secondary" @click=${() => this.executeAction('shell')} ?disabled=${!isRunning && !isCompleted}>
              Open Shell
            </button>
            <button class="action-button secondary" @click=${() => this.executeAction('openWorkspace')}>
              Open Workspace
            </button>
            <button class="action-button secondary" @click=${() => this.executeAction('refresh')}>
              Refresh
            </button>
            <button class="action-button secondary" @click=${() => this.executeAction('delete')} style="color: var(--vscode-errorForeground);">
              Delete Task
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderLatestSummary() {
    if (!this.taskData.iterations || this.taskData.iterations.length === 0) {
      return '';
    }

    const latestIteration = this.taskData.iterations[this.taskData.iterations.length - 1];
    if (!latestIteration.summaryContent) {
      return '';
    }

    return html`
      <div>
        <div class="summary-label">Latest Summary</div>
        <div class="summary-content">${latestIteration.summaryContent}</div>
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
          const isExpanded = !this.expandedSections.has(`iteration-${iterationId}`);

          return html`
            <div class="iteration">
              <div class="iteration-header" @click=${() => this.toggleIteration(iterationId)}>
                <span class="iteration-title">Iteration ${iteration.number || (index + 1)}</span>
                <span class="status-badge ${this.getStatusClass(iteration.status)}">
                  ${iteration.status || 'Unknown'}
                </span>
                <span class="expand-icon ${isExpanded ? 'expanded' : ''}">▶</span>
              </div>
              <div class="iteration-content ${!isExpanded ? 'collapsed' : ''}">
                <div class="field-row">
                  <span class="field-label">Started:</span>
                  <span class="field-value">${this.formatDate(iteration.startedAt)}</span>
                </div>
                ${iteration.completedAt ? html`
                  <div class="field-row">
                    <span class="field-label">Completed:</span>
                    <span class="field-value">${this.formatDate(iteration.completedAt)}</span>
                  </div>
                ` : ''}
                <div class="field-row">
                  <span class="field-label">Files:</span>
                  <div class="field-value">
                    <div class="file-buttons">
                      ${iteration.files?.length ? iteration.files.map((file: any) => html`
                        <button class="file-button" @click=${() => this.openFile(file.path)} ?disabled=${!file.exists}>
                          ${file.name}
                        </button>
                      `) : html`<span style="color: var(--vscode-descriptionForeground);">No files available</span>`}
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
  const vscode = typeof window.acquireVsCodeApi !== 'undefined' ? window.acquireVsCodeApi() : null;

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
