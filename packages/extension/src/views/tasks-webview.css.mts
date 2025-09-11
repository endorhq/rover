import { css } from 'lit';
import codiconsIcons from './common/codicons.mjs';

const styles = css`
  :host {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: var(--vscode-font-family);
    margin: 0;
    padding: 8px;
    background-color: var(--vscode-sideBar-background);
    color: var(--vscode-sideBar-foreground);
    font-size: 13px;
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
    position: relative;
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
    align-items: center;
    gap: 6px;
    opacity: 0;
    transition: opacity 0.2s;
    background: var(--vscode-list-hoverBackground);
    box-shadow: -7px 0 28px var(--vscode-sideBar-background);
    position: absolute;
    height: 100%;
    padding: 0 8px;
    right: 0;
  }

  .task-item:hover .task-actions {
    opacity: 1;
  }

  .action-btn {
    background: none;
    border: none;
    color: var(--vscode-button-foreground);
    cursor: pointer;
    padding: 3px 2px;
    border-radius: 2px;
    font-size: 12px;
    display: flex;
  }

  .action-btn:hover {
    background-color: var(--vscode-button-hoverBackground);
  }

  .create-form {
    border-top: 1px solid var(--vscode-sideBar-border);
    padding: 1em 0 15px 0;
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

  .status-completed {
    background-color: var(--vscode-testing-iconPassed);
    color: white;
  }
  .status-failed {
    background-color: var(--vscode-testing-iconFailed);
    color: white;
  }
  .status-running {
    background-color: var(--vscode-testing-iconQueued);
    color: white;
  }
  .status-new {
    background-color: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }

  .codicon {
    font-size: 16px;
    font-family: codicon;
    font-style: normal;
  }

  .codicon.success {
    color: var(--vscode-testing-iconPassed);
  }

  .codicon.failed {
    color: var(--vscode-testing-iconFailed);
  }

  .codicon.running {
    color: var(--vscode-testing-iconQueued);
  }

  .codicon.other {
    color: var(--vscode-testing-iconUnset);
  }

  /* Codicon definitions */
  ${codiconsIcons}
`;

export default styles;
