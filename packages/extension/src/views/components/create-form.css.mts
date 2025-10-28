import { css } from 'lit';
import codiconsIcons from '../common/codicons.mjs';

const styles = css`
  .create-form {
    border-top: 1px solid var(--vscode-sideBar-border);
    padding-bottom: 24px;
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
    margin-bottom: 8px;
  }

  .form-title {
    font-size: 0.85rem;
    font-weight: 600;
    margin: 8px 0 6px;
  }

  .form-field {
    margin-top: 8px;
  }

  .form-label {
    display: block;
    font-size: 0.75rem;
    letter-spacing: 0.2px;
    margin-bottom: 3px;
    font-weight: 500;
  }

  .form-desc {
    font-size: 0.75rem;
    color: var(--vscode-descriptionForeground);
    margin: 6px 0 14px;
  }

  .form-textarea:focus {
    outline: none;
    border-color: var(--vscode-focusBorder);
  }

  .form-textarea::placeholder {
    color: var(--vscode-input-placeholderForeground);
  }

  /* Error Message */
  .error-message {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    margin-bottom: 8px;
    background-color: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    border-radius: 3px;
    color: var(--vscode-inputValidation-errorForeground);
    font-size: 11px;
  }

  .error-message .codicon {
    font-size: 12px;
    flex-shrink: 0;
  }

  /* Upgrade Message */
  .upgrade-message {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    background-color: var(--vscode-inputValidation-infoBackground);
    border: 1px solid var(--vscode-inputValidation-infoBorder);
    border-radius: 3px;
    color: var(--vscode-inputValidation-infoForeground);
    font-size: 11px;
  }

  .upgrade-message .codicon {
    font-size: 14px;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .upgrade-message p {
    margin: 0 0 6px 0;
  }

  .upgrade-message p:last-child {
    margin-bottom: 0;
  }

  .upgrade-message code {
    display: block;
    margin-top: 6px;
    padding: 6px 8px;
    background-color: var(--vscode-textCodeBlock-background);
    border-radius: 2px;
    font-family: var(--vscode-editor-font-family);
    font-size: 11px;
    overflow-x: auto;
  }

  /* Form Controls Container */
  .form-controls {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
  }

  .form-controls-left {
    display: flex;
    gap: 6px;
    flex: 1;
  }

  .form-controls-right {
    flex-shrink: 0;
  }

  /* Dropdown Container */
  .dropdown-container {
    position: relative;
  }

  /* Dropdown Button */
  .dropdown-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 2px;
    font-size: 11px;
    font-family: var(--vscode-font-family);
    cursor: pointer;
    white-space: nowrap;
    transition: background-color 0.1s;
  }

  .dropdown-button:hover {
    background: var(--vscode-toolbar-hoverBackground);
  }

  .dropdown-button .codicon {
    font-size: 12px;
  }

  .dropdown-button .codicon-chevron-down {
    margin-left: 2px;
    opacity: 0.6;
  }

  /* Dropdown Menu */
  .dropdown-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 3px;
    box-shadow: 0 2px 8px var(--vscode-widget-shadow);
    z-index: 1000;
    min-width: 140px;
    padding: 4px 0;
  }

  /* Dropdown positioned above button */
  .dropdown-menu.dropdown-up {
    top: auto;
    bottom: calc(100% + 6px);
    box-shadow: 0 -2px 8px var(--vscode-widget-shadow);
  }

  /* Dropdown Item */
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
    transition: background-color 0.1s;
  }

  .dropdown-item:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .dropdown-item.selected {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }

  .dropdown-item .codicon-check {
    margin-left: auto;
    font-size: 12px;
  }

  /* Create Button */
  .create-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 2px;
    font-size: 11px;
    font-family: var(--vscode-font-family);
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.1s;
    white-space: nowrap;
  }

  .create-button:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
  }

  .create-button:disabled {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    cursor: not-allowed;
    opacity: 0.6;
  }

  .create-button .codicon {
    font-size: 13px;
  }

  /* Loading spinner animation */
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .spin {
    animation: spin 1.5s linear infinite;
  }

  /* Codicon definitions */
  ${codiconsIcons}
`;

export default styles;
