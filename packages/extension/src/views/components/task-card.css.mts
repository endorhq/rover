import { css } from 'lit';
import codiconsIcons from '../common/codicons.mjs';

const styles = css`
  :host {
    display: block;
  }

  .task-card {
    padding: 12px;
    border: 1px solid var(--vscode-widget-border);
    border-radius: 4px;
    margin-bottom: 8px;
    background-color: var(--vscode-editor-background);
    transition: border-color 0.1s;
  }

  .task-card:hover {
    border-color: var(--vscode-focusBorder);
  }

  .task-header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 4px;
  }

  .task-id {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 13px;
    color: var(--vscode-descriptionForeground);
    padding-top: 1px;
    line-height: 1.4;
    flex-shrink: 0;
  }

  .task-title {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
    color: var(--vscode-foreground);
    line-height: 1.4;
    word-break: break-word;
  }

  .task-metadata {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .status-badge .codicon {
    font-size: 12px;
  }

  .status-badge.completed {
    color: var(--vscode-testing-iconPassed);
  }

  .status-badge.merged {
    color: var(--vscode-gitDecoration-modifiedResourceForeground);
  }

  .status-badge.pushed {
    color: var(--vscode-gitDecoration-addedResourceForeground);
  }

  .status-badge.failed {
    color: var(--vscode-testing-iconFailed);
  }

  .status-badge.running,
  .status-badge.initializing,
  .status-badge.iterating,
  .status-badge.installing {
    color: var(--vscode-testing-iconQueued);
  }

  .spin {
    animation: spin 1.5s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .status-badge.pending {
    color: var(--vscode-badge-foreground);
  }

  .task-workflow {
    font-size: 11px;
    color: var(--vscode-foreground);
    flex-shrink: 0;
  }

  .task-timestamp {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    flex: 1;
  }

  .task-progress {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .task-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    gap: 8px;
  }

  .action-group {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .action-button {
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 2px;
    padding: 3px 6px;
    font-size: 11px;
    font-family: var(--vscode-font-family);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: background-color 0.1s;
  }

  .action-button:hover {
    background: var(--vscode-toolbar-hoverBackground);
  }

  .action-button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }

  .action-button.secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }

  .action-button .codicon {
    font-size: 13px;
  }

  .details-button {
    background: transparent;
    color: var(--vscode-textLink-foreground);
    border: none;
    padding: 3px 6px;
    font-size: 11px;
    font-family: var(--vscode-font-family);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: opacity 0.1s;
    text-decoration: none;
    border-radius: 4px;
  }

  .details-button:hover {
    background: var(--vscode-toolbar-hoverBackground);
  }

  .more-actions-container {
    position: relative;
  }

  .more-actions-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 3px;
    box-shadow: 0 2px 8px var(--vscode-widget-shadow);
    z-index: 1000;
    min-width: 140px;
    padding: 4px 0;
    margin-top: 2px;
  }

  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: transparent;
    border: none;
    color: var(--vscode-dropdown-foreground);
    font-size: 11px;
    font-family: var(--vscode-font-family);
    cursor: pointer;
    width: 100%;
    text-align: left;
  }

  .dropdown-item:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .dropdown-item .codicon {
    font-size: 14px;
    flex-shrink: 0;
  }

  .dropdown-item.danger {
    color: var(--vscode-errorForeground);
  }

  .dropdown-item.danger:hover {
    background: rgba(248, 113, 113, 0.1);
  }

  /* Codicon definitions */
  ${codiconsIcons}
`;

export default styles;
