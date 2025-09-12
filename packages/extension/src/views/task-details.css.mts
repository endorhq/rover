import { css } from 'lit';
import codiconsIcons from './common/codicons.mjs';

const styles = css`
  :host {
    display: block;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    font-weight: var(--vscode-font-weight);
    padding: 12px;
    margin: 0;
    background-color: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    line-height: 1.4;
  }

  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 20px;
    padding: 16px 0;
    border-bottom: 1px solid var(--vscode-widget-border);
    gap: 16px;
  }

  .header-main {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .header-title-block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .title-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 2px;
    min-width: 0;
  }

  .header-id {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 18px;
    color: var(--vscode-descriptionForeground);
    flex-shrink: 0;
    font-weight: 500;
  }

  .header-title {
    font-size: 20px;
    font-weight: 600;
    margin: 0;
    color: var(--vscode-foreground);
    word-break: break-word;
    line-height: 1.3;
    flex: 1;
    min-width: 0;
    overflow-wrap: break-word;
    hyphens: auto;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    min-width: 0;
  }

  .time-info {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family, monospace);
    flex-shrink: 1;
    min-width: 0;
  }

  .header-actions {
    flex-shrink: 0;
    display: flex;
    align-items: flex-start;
  }

  /* Responsive behavior for small screens */
  @media (max-width: 900px) {
    .header {
      flex-direction: column;
      align-items: stretch;
      gap: 12px;
    }

    .header-actions {
      align-self: flex-start;
    }

    .action-buttons {
      flex-wrap: wrap;
      gap: 6px;
    }

    .title-row {
      flex-wrap: wrap;
    }

    .header-title {
      font-size: 18px;
    }

    .status-row {
      gap: 8px;
    }

    .time-info {
      font-size: 11px;
    }
  }

  /* Extra responsive behavior for very small screens */
  @media (max-width: 600px) {
    .header-actions {
      align-self: stretch;
    }

    .action-buttons {
      justify-content: flex-start;
    }

    .action-button {
      flex: 1;
      min-width: 0;
      justify-content: center;
    }

    .header-title {
      font-size: 16px;
    }
  }

  .section {
    margin-bottom: 12px;
    background: transparent;
    border: none;
    overflow: hidden;
  }

  .section-header {
    padding: 4px 0;
    margin-bottom: 6px;
    background: transparent;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    user-select: none;
    transition: all 0.15s;
  }

  .section-header:hover {
    color: var(--vscode-foreground);
  }

  .section-header .codicon {
    font-size: 13px;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .section-header.expanded .codicon-chevron-right {
    transform: rotate(90deg);
  }

  .section-content {
    padding: 0;
    margin-left: 0;
    animation: fadeIn 0.2s ease;
  }

  .section-content.collapsed {
    display: none;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .field-row {
    display: flex;
    margin-bottom: 4px;
    align-items: baseline;
    font-size: 12px;
    padding: 2px 0;
  }

  .field-label {
    min-width: 80px;
    margin-right: 8px;
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }

  .field-value {
    flex: 1;
    color: var(--vscode-foreground);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    margin-right: 6px;
    gap: 3px;
    font-size: 12px;
    font-weight: 500;
    flex-shrink: 0;
  }

  .status-badge .codicon {
    font-size: 12px;
  }

  .status-completed {
    color: var(--vscode-testing-iconPassed);
  }

  .status-merged {
    color: var(--vscode-gitDecoration-modifiedResourceForeground);
  }

  .status-pushed {
    color: var(--vscode-gitDecoration-addedResourceForeground);
  }

  .status-failed {
    color: var(--vscode-testing-iconFailed);
  }

  .status-running,
  .status-initializing,
  .status-installing {
    color: var(--vscode-testing-iconQueued);
  }

  .status-new,
  .status-pending {
    color: var(--vscode-badge-foreground);
  }

  .description {
    margin: 8px 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--vscode-foreground);
    border-radius: 3px;
  }

  .iteration {
    border: 1px solid var(--vscode-widget-border);
    border-radius: 3px;
    margin-bottom: 6px;
    overflow: hidden;
    background-color: var(--vscode-editor-background);
    transition: all 0.15s;
  }

  .iteration:hover {
    border-color: var(--vscode-focusBorder);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }

  .iteration-header {
    padding: 8px 10px;
    background-color: transparent;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    user-select: none;
    font-size: 12px;
    transition: background-color 0.1s;
  }

  .iteration-header:hover {
    background-color: var(--vscode-list-hoverBackground);
  }

  .iteration-header .codicon {
    font-size: 13px;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    flex-shrink: 0;
  }

  .iteration-header.expanded .codicon-chevron-right {
    transform: rotate(90deg);
  }

  .iteration-title {
    font-weight: 500;
    flex: 1;
    color: var(--vscode-foreground);
  }

  .iteration-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  .iteration-content {
    padding: 10px;
    border-top: 1px solid var(--vscode-widget-border);
    background-color: var(--vscode-editor-inactiveSelectionBackground);
    animation: slideDown 0.2s ease;
  }

  .iteration-content.collapsed {
    display: none;
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      max-height: 0;
    }
    to {
      opacity: 1;
      max-height: 500px;
    }
  }

  .file-buttons {
    display: flex;
    margin-left: -8px;
    gap: 4px;
    flex-wrap: wrap;
  }

  .file-button {
    background: transparent;
    color: var(--vscode-textLink-foreground);
    border: 1px solid transparent;
    padding: 2px 6px;
    border-radius: 2px;
    cursor: pointer;
    font-size: 11px;
    font-family: var(--vscode-font-family);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: all 0.1s;
    text-decoration: none;
  }

  .file-button:hover {
    background-color: var(--vscode-toolbar-hoverBackground);
    border-color: var(--vscode-button-border);
  }

  .file-button .codicon {
    font-size: 12px;
  }

  .file-button:disabled {
    color: var(--vscode-disabledForeground);
    cursor: not-allowed;
    opacity: 0.5;
  }

  .file-button:disabled:hover {
    background: transparent;
    border-color: transparent;
  }

  .action-buttons {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .action-button {
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 3px;
    padding: 6px 12px;
    font-size: 12px;
    font-family: var(--vscode-font-family);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: background-color 0.1s;
    min-height: 28px;
  }

  .action-button:hover {
    background: var(--vscode-toolbar-hoverBackground);
  }

  .action-button .codicon {
    font-size: 14px;
  }

  .action-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .action-button:disabled:active {
    transform: none;
  }

  .action-button:disabled:hover {
    background: transparent;
    border-color: transparent;
  }

  .action-button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: var(--vscode-button-border, transparent);
  }

  .action-button.primary:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .action-button.secondary {
    background: transparent;
    color: var(--vscode-foreground);
  }

  .action-button.secondary:hover {
    background: var(--vscode-toolbar-hoverBackground);
  }

  .action-button.danger {
    color: var(--vscode-errorForeground);
  }

  .action-button.danger:hover {
    background: var(
      --vscode-inputValidation-errorBackground,
      rgba(248, 113, 113, 0.1)
    );
    border-color: var(
      --vscode-inputValidation-errorBorder,
      var(--vscode-errorForeground)
    );
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
    padding: 8px 0;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    font-style: italic;
  }

  .info-card {
    background: var(--vscode-editor-inactiveSelectionBackground);
    border: 1px solid var(--vscode-widget-border);
    border-radius: 3px;
    padding: 8px 10px;
    margin-bottom: 8px;
  }

  .info-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    font-size: 12px;
  }

  .info-label {
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }

  .info-value {
    color: var(--vscode-foreground);
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .codicon-sync ~ spin {
    animation: spin 1s linear infinite;
  }

  .summary-content {
    margin-top: 6px;
    padding: 8px;
    background-color: var(--vscode-editor-inactiveSelectionBackground);
    border: 1px solid var(--vscode-widget-border);
    border-radius: 3px;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .summary-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .summary-label .codicon {
    font-size: 12px;
  }

  /* Tab styling */
  .tabs-container {
    border: 1px solid var(--vscode-widget-border);
    border-radius: 3px;
    overflow: hidden;
  }

  .tab-bar {
    display: flex;
    background: var(
      --vscode-tab-inactiveBackground,
      var(--vscode-editor-background)
    );
    border-bottom: 1px solid var(--vscode-widget-border);
    overflow-x: auto;
    overflow-y: hidden;
  }

  .tab {
    background: transparent;
    color: var(--vscode-tab-inactiveForeground);
    border: none;
    border-right: 1px solid var(--vscode-widget-border);
    padding: 8px 12px;
    font-size: 11px;
    font-family: var(--vscode-font-family);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: all 0.1s;
    white-space: nowrap;
    flex-shrink: 0;
    min-width: 0;
  }

  .tab:last-child {
    border-right: none;
  }

  .tab:hover {
    background: var(
      --vscode-tab-hoverBackground,
      var(--vscode-toolbar-hoverBackground)
    );
    color: var(--vscode-tab-hoverForeground, var(--vscode-foreground));
  }

  .tab.active {
    background: var(
      --vscode-tab-activeBackground,
      var(--vscode-editor-background)
    );
    color: var(--vscode-tab-activeForeground, var(--vscode-foreground));
  }

  .tab .codicon {
    font-size: 12px;
    flex-shrink: 0;
  }

  .tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .tab-content {
    background: var(
      --vscode-tab-inactiveBackground,
      var(--vscode-editor-background)
    );
    min-height: 200px;
    max-height: 400px;
    overflow: auto;
  }

  .tab-panel {
    padding: 12px;
  }

  .file-content {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    line-height: 1.4;
    color: var(--vscode-editor-foreground);
  }

  .file-content pre {
    margin: 0;
    padding: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .file-content code {
    font-family: inherit;
    font-size: inherit;
    background: transparent;
    padding: 0;
  }

  .file-missing {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-editor-inactiveSelectionBackground);
    border-radius: 3px;
    font-size: 12px;
  }

  .file-missing .codicon {
    font-size: 16px;
    color: var(
      --vscode-notificationsWarningIcon-foreground,
      var(--vscode-descriptionForeground)
    );
  }

  /* Responsive tabs */
  @media (max-width: 600px) {
    .tab {
      padding: 6px 10px;
      font-size: 10px;
    }

    .tab-label {
      display: none;
    }

    .tab .codicon {
      font-size: 14px;
    }

    .tab-content {
      min-height: 150px;
      max-height: 300px;
    }

    .tab-panel {
      padding: 8px;
    }
  }

  /* Codicon definitions */
  ${codiconsIcons}
`;

export default styles;
