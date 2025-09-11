import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import styles from './task-card.css.mjs';

@customElement('task-card')
export class TaskCard extends LitElement {
  @property({ type: Object }) task: any = null;
  @property({ type: Object }) vscode: any = null;

  static styles = styles;

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

  private inspectTask() {
    const event = new CustomEvent('inspect-task', {
      detail: { taskId: this.task.id, taskTitle: this.task.title },
      bubbles: true,
      composed: true
    });
    this.dispatchEvent(event);
  }

  private executeTaskAction(
    event: Event,
    action: string,
    taskStatus?: string
  ) {
    event.stopPropagation();

    const customEvent = new CustomEvent('task-action', {
      detail: {
        action,
        taskId: this.task.id,
        taskTitle: this.task.title,
        taskStatus: taskStatus || this.task.status
      },
      bubbles: true,
      composed: true
    });
    this.dispatchEvent(customEvent);
  }

  render() {
    if (!this.task) return html``;

    const timeInfo = this.formatTimeInfo(this.task);
    const details = [this.task.status.toUpperCase()];

    if (timeInfo) details.push(timeInfo);
    if (this.task.progress !== undefined && this.task.progress > 0)
      details.push(`${this.task.progress}%`);
    if (this.task.currentStep && this.task.status === 'RUNNING')
      details.push(`Step: ${this.task.currentStep}`);

    const isRunning = [
      'RUNNING',
      'INITIALIZING',
      'INSTALLING',
    ].includes(this.task.status?.toLowerCase());
    const isCompleted = ['COMPLETED', 'MERGED', 'PUSHED'].includes(
      this.task.status?.toLowerCase()
    );

    return html`
      <div class="task-item" @click=${this.inspectTask}>
        <div class="task-icon">
          <i class="codicon ${this.getStatusIcon(this.task.status)}"></i>
        </div>
        <div class="task-content">
          <div class="task-title">${this.task.title}</div>
          <div class="task-details">${details.join(' • ')}</div>
        </div>
        <div class="task-actions">
          ${isCompleted
        ? html`
                <button
                  class="action-btn"
                  @click=${(e: Event) =>
            this.executeTaskAction(e, 'gitCompare')}
                  title="Compare Task Changes"
                >
                  <i class="codicon codicon-diff-multiple"></i>
                </button>
                <button
                  class="action-btn"
                  @click=${(e: Event) =>
            this.executeTaskAction(e, 'iterateTask')}
                  title="Iterate Task"
                >
                  <i class="codicon codicon-debug-rerun"></i>
                </button>
                <button
                  class="action-btn"
                  @click=${(e: Event) =>
            this.executeTaskAction(e, 'mergeTask')}
                  title="Merge Task"
                >
                  <i class="codicon codicon-git-merge"></i>
                </button>
                <button
                  class="action-btn"
                  @click=${(e: Event) =>
            this.executeTaskAction(e, 'pushBranch')}
                  title="Push Task Branch"
                >
                  <i class="codicon codicon-repo-push"></i>
                </button>
              `
        : ''}
          <button
            class="action-btn"
            @click=${(e: Event) =>
        this.executeTaskAction(e, 'viewLogs', this.task.status)}
            title="View Logs"
          >
            <i class="codicon codicon-file"></i>
          </button>
          ${isRunning || isCompleted
        ? html`
                <button
                  class="action-btn"
                  @click=${(e: Event) =>
            this.executeTaskAction(e, 'openShell')}
                  title="Open Shell"
                >
                  <i class="codicon codicon-terminal"></i>
                </button>
              `
        : ''}
          <button
            class="action-btn"
            @click=${(e: Event) =>
        this.executeTaskAction(e, 'openWorkspace')}
            title="Open Workspace"
          >
            <i class="codicon codicon-folder"></i>
          </button>
          <button
            class="action-btn"
            @click=${(e: Event) =>
        this.executeTaskAction(e, 'deleteTask')}
            title="Delete Task"
          >
            <i class="codicon codicon-trash"></i>
          </button>
        </div>
      </div>
    `;
  }
}