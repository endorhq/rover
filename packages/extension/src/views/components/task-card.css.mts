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
    margin-bottom: 8px;
  }

  .task-id {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    background-color: var(--vscode-textBlockQuote-background);
    border: 1px solid var(--vscode-textBlockQuote-border);
    padding: 2px 6px;
    border-radius: 3px;
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
    padding: 2px 8px;
    border-radius: 11px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    flex-shrink: 0;
    border: 1px solid transparent;
  }

  .status-badge .codicon {
    font-size: 12px;
  }

  .status-badge.completed {
    background-color: rgba(73, 214, 155, 0.15);
    color: var(--vscode-testing-iconPassed);
    border-color: rgba(73, 214, 155, 0.3);
  }

  .status-badge.merged {
    background-color: rgba(139, 92, 246, 0.15);
    color: var(--vscode-gitDecoration-modifiedResourceForeground);
    border-color: rgba(139, 92, 246, 0.3);
  }

  .status-badge.pushed {
    background-color: rgba(34, 197, 94, 0.15);
    color: var(--vscode-gitDecoration-addedResourceForeground);
    border-color: rgba(34, 197, 94, 0.3);
  }

  .status-badge.failed {
    background-color: rgba(248, 113, 113, 0.15);
    color: var(--vscode-testing-iconFailed);
    border-color: rgba(248, 113, 113, 0.3);
  }

  .status-badge.running,
  .status-badge.initializing,
  .status-badge.installing {
    background-color: rgba(59, 130, 246, 0.15);
    color: var(--vscode-testing-iconQueued);
    border-color: rgba(59, 130, 246, 0.3);
  }

  .status-badge.pending {
    background-color: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    border-color: var(--vscode-contrastBorder, transparent);
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
    border-radius: 2px;
  }

  .details-button:hover {
    background: var(--vscode-toolbar-hoverBackground);
  }

  .codicon {
    font-family: codicon;
    font-style: normal;
  }

  /* Codicon definitions */
  ${codiconsIcons}
`;

export default styles;
