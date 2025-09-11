import { LitElement, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import styles from './task-card.css.mjs';

@customElement('task-card')
export class TaskCard extends LitElement {
  @property({ type: Object }) task: any = null;

  static styles = styles;

  private getStatusIcon(status?: string): string {
    switch (status?.toUpperCase()) {
      case 'COMPLETED':
        return 'codicon-pass-filled';
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

  private getStatusClass(status?: string): string {
    return status?.toLowerCase() || 'pending';
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

  private inspectTask() {
    const event = new CustomEvent('inspect-task', {
      detail: { taskId: this.task.id, taskTitle: this.task.title },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  private executeTaskAction(event: Event, action: string, taskStatus?: string) {
    event.stopPropagation();

    const customEvent = new CustomEvent('task-action', {
      detail: {
        action,
        taskId: this.task.id,
        taskTitle: this.task.title,
        taskStatus: taskStatus || this.task.status,
      },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);
  }

  private showMoreActions(event: Event) {
    event.stopPropagation();

    // Create a custom event for showing more actions menu
    // The parent component can handle this to show a context menu
    const customEvent = new CustomEvent('show-more-actions', {
      detail: {
        taskId: this.task.id,
        taskTitle: this.task.title,
        taskStatus: this.task.status,
        actions: [
          {
            action: 'openWorkspace',
            label: 'Open Workspace',
            icon: 'folder-opened',
          },
          { action: 'pushBranch', label: 'Push Branch', icon: 'repo-push' },
          {
            action: 'iterateTask',
            label: 'Iterate Task',
            icon: 'debug-restart',
          },
          { action: 'deleteTask', label: 'Delete Task', icon: 'trash' },
        ],
        x: (event as MouseEvent).clientX,
        y: (event as MouseEvent).clientY,
      },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);
  }

  render() {
    if (!this.task) return html``;

    const timeInfo = this.formatTimeInfo(this.task);
    const isRunning = ['running', 'initializing', 'installing'].includes(
      this.task.status?.toLowerCase()
    );
    const isCompleted = ['completed', 'merged', 'pushed'].includes(
      this.task.status?.toLowerCase()
    );
    const isFailed = this.task.status?.toLowerCase() === 'failed';

    return html`
      <div class="task-card">
        <!-- Header with Task ID and Title -->
        <div class="task-header">
          <span class="task-id">#${this.task.id}</span>
          <div class="task-title">${this.task.title}</div>
        </div>

        <!-- Metadata line with status badge and timestamp -->
        <div class="task-metadata">
          <span class="status-badge ${this.getStatusClass(this.task.status)}">
            <i class="codicon ${this.getStatusIcon(this.task.status)}"></i>
            ${this.task.status}
          </span>
          ${timeInfo
            ? html`<span class="task-timestamp">${timeInfo}</span>`
            : ''}
          ${this.task.progress !== undefined && this.task.progress > 0
            ? html`<span class="task-progress">${this.task.progress}%</span>`
            : ''}
          ${this.task.currentStep && isRunning
            ? html`<span class="task-progress">${this.task.currentStep}</span>`
            : ''}
        </div>

        <!-- Action buttons -->
        <div class="task-actions">
          <!-- Left side: Quick actions + More actions -->
          <div class="action-group">
            <!-- Primary actions based on status -->
            ${isCompleted
              ? html`
                  <button
                    class="action-button"
                    @click=${(e: Event) =>
                      this.executeTaskAction(e, 'gitCompare')}
                    title="Compare changes made by this task"
                  >
                    <i class="codicon codicon-diff"></i>
                    Compare
                  </button>
                  <button
                    class="action-button"
                    @click=${(e: Event) =>
                      this.executeTaskAction(e, 'mergeTask')}
                    title="Merge task changes into main branch"
                  >
                    <i class="codicon codicon-git-merge"></i>
                    Merge
                  </button>
                `
              : ''}
            ${isRunning
              ? html`
                  <button
                    class="action-button"
                    @click=${(e: Event) =>
                      this.executeTaskAction(e, 'viewLogs', this.task.status)}
                    title="View task execution logs"
                  >
                    <i class="codicon codicon-output"></i>
                    Logs
                  </button>
                  <button
                    class="action-button"
                    @click=${(e: Event) =>
                      this.executeTaskAction(e, 'openShell')}
                    title="Open shell in task workspace"
                  >
                    <i class="codicon codicon-terminal"></i>
                    Shell
                  </button>
                `
              : ''}
            ${isFailed
              ? html`
                  <button
                    class="action-button"
                    @click=${(e: Event) =>
                      this.executeTaskAction(e, 'viewLogs', this.task.status)}
                    title="View error logs"
                  >
                    <i class="codicon codicon-output"></i>
                    Error Logs
                  </button>
                  <button
                    class="action-button"
                    @click=${(e: Event) =>
                      this.executeTaskAction(e, 'iterateTask')}
                    title="Retry or fix this task"
                  >
                    <i class="codicon codicon-debug-restart"></i>
                    Retry
                  </button>
                `
              : ''}

            <!-- More actions button -->
            <button
              class="action-button"
              @click=${(e: Event) => this.showMoreActions(e)}
              title="More actions"
            >
              <i class="codicon codicon-ellipsis"></i>
            </button>
          </div>

          <!-- Right side: Details button -->
          <button
            class="details-button"
            @click=${this.inspectTask}
            title="View detailed task information"
          >
            <i class="codicon codicon-info"></i>
            Details
          </button>
        </div>
      </div>
    `;
  }
}
