import { css } from 'lit';
import codiconsIcons from '../common/codicons.mjs';

const styles = css`
  .guide-container {
    padding: 20px;
    max-width: 600px;
    margin: 0 auto;
  }

  .guide-logo {
    height: 72px;
    display: block;
    margin: 0 auto 0.5rem;
  }

  .guide-title {
    text-align: center;
    font-size: 1.5em;
    font-weight: 600;
    margin-bottom: 18px;
    color: var(--vscode-foreground);
  }

  .guide-description {
    margin-bottom: 12px;
    color: var(--vscode-descriptionForeground);
    line-height: 1.5;
  }

  .setup-steps {
    display: flex;
    flex-direction: column;
    margin-top: 24px;
    gap: 16px;
  }

  .setup-step {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 16px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    background-color: var(--vscode-editor-background);
  }

  .setup-step.completed {
    border-color: var(--vscode-testing-iconPassed);
  }

  .setup-step.current {
    border-color: var(--vscode-focusBorder);
  }

  .step-icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-size: 12px;
    font-weight: 600;
  }

  .step-icon.completed {
    background-color: var(--vscode-testing-iconPassed);
    color: white;
  }

  .step-icon.current {
    background-color: var(--vscode-focusBorder);
    color: white;
  }

  .step-icon.pending {
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
  }

  .step-content {
    flex: 1;
  }

  .step-title {
    font-weight: 600;
    margin-bottom: 4px;
    color: var(--vscode-foreground);
  }

  .step-description {
    color: var(--vscode-foreground);
    font-size: 0.9em;
    margin-bottom: 12px;
  }

  .step-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .action-button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9em;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .action-button:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .action-button:disabled {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    cursor: not-allowed;
    opacity: 0.6;
  }

  .action-button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }

  .action-button.secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }

  .loading-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid transparent;
    border-top: 2px solid currentColor;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.9em;
    margin-top: 4px;
  }

  .status-success {
    color: var(--vscode-testing-iconPassed);
  }

  .status-error {
    color: var(--vscode-errorForeground);
  }

  .error-message {
    background-color: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    color: var(--vscode-inputValidation-errorForeground);
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 0.9em;
    margin-top: 8px;
  }

  /* Codicon definitions */
  ${codiconsIcons}
`;

export default styles;
