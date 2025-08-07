import * as vscode from 'vscode';
import { RoverTask } from '../rover/types.js';

export class TaskItem extends vscode.TreeItem {
    constructor(
        public readonly task: RoverTask,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        super(task.title, collapsibleState);

        this.id = task.id;
        this.description = this.getDetailedDescription();
        this.tooltip = this.getTooltip();
        this.iconPath = this.getIcon();
        this.contextValue = this.getContextValue();
    }

    private getDetailedDescription(): string {
        const statusText = this.task.status.toUpperCase();
        const timeInfo = this.getTimeInfo();
        const progressInfo = this.getProgressInfo();

        let details = [statusText];

        if (timeInfo) {
            details.push(timeInfo);
        }

        if (progressInfo) {
            details.push(progressInfo);
        }

        if (this.task.currentStep && this.task.status === 'running') {
            details.push(`Step: ${this.task.currentStep}`);
        }

        return details.join(' • ');
    }

    private getTimeInfo(): string | null {
        if (this.task.completedAt) {
            const completed = new Date(this.task.completedAt);
            return `Completed ${this.formatRelativeTime(completed)}`;
        }

        if (this.task.status === 'running' || this.task.status === 'initializing' || this.task.status === 'installing') {
            const started = new Date(this.task.startedAt);
            return `Started ${this.formatRelativeTime(started)}`;
        }

        if (this.task.status === 'failed') {
            const started = new Date(this.task.startedAt);
            return `Failed after ${this.formatDuration(started)}`;
        }

        return null;
    }

    private getProgressInfo(): string | null {
        if (this.task.progress !== undefined && this.task.progress > 0) {
            return `${this.task.progress}%`;
        }
        return null;
    }

    private formatRelativeTime(date: Date): string {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) {
            return 'just now';
        } else if (diffMins < 60) {
            return `${diffMins}m ago`;
        } else if (diffHours < 24) {
            return `${diffHours}h ago`;
        } else if (diffDays === 1) {
            return 'yesterday';
        } else if (diffDays < 7) {
            return `${diffDays}d ago`;
        } else {
            return date.toLocaleDateString();
        }
    }

    private formatDuration(startDate: Date): string {
        const now = new Date();
        const diffMs = now.getTime() - startDate.getTime();
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMins / 60);

        if (diffMins < 60) {
            return `${diffMins}m`;
        } else {
            const remainingMins = diffMins % 60;
            return remainingMins > 0 ? `${diffHours}h ${remainingMins}m` : `${diffHours}h`;
        }
    }

    private getTooltip(): string {
        let tooltip = `Task: ${this.task.title}\n`;
        tooltip += `Status: ${this.task.status}\n`;
        tooltip += `Started: ${new Date(this.task.startedAt).toLocaleString()}\n`;

        if (this.task.completedAt) {
            tooltip += `Completed: ${new Date(this.task.completedAt).toLocaleString()}\n`;
        }

        if (this.task.progress !== undefined) {
            tooltip += `Progress: ${this.task.progress}%\n`;
        }

        if (this.task.currentStep) {
            tooltip += `Current Step: ${this.task.currentStep}\n`;
        }

        if (this.task.error) {
            tooltip += `Error: ${this.task.error}`;
        }

        return tooltip;
    }

    private getIcon(): vscode.ThemeIcon {
        switch (this.task.status) {
            case 'initializing':
                return new vscode.ThemeIcon('loading~spin');
            case 'installing':
                return new vscode.ThemeIcon('cloud-download');
            case 'running':
                return new vscode.ThemeIcon('play-circle');
            case 'completed':
                return new vscode.ThemeIcon('check-all', new vscode.ThemeColor('terminal.ansiGreen'));
            case 'failed':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('terminal.ansiRed'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    private getContextValue(): string {
        // Context value determines which commands are shown in the context menu
        switch (this.task.status) {
            case 'running':
            case 'initializing':
            case 'installing':
                return 'task-running';
            case 'completed':
                return 'task-completed';
            case 'failed':
                return 'task-failed';
            default:
                return 'task-unknown';
        }
    }
}