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

  .empty-state {
    text-align: center;
    padding: 20px;
    color: var(--vscode-descriptionForeground);
  }

  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    color: var(--vscode-descriptionForeground);
  }

  .loading-spinner {
    width: 36px;
    height: 36px;
    margin-bottom: 8px;
    position: relative;
  }

  .spinner-icon {
    position: absolute;
    animation: spin 1.5s linear infinite;
    font-size: 36px;
    color: var(--vscode-progressBar-background);
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .loading-text {
    font-size: 13px;
    margin-bottom: 4px;
  }

  .loading-subtext {
    font-size: 11px;
    opacity: 0.7;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.5;
    }
    50% {
      opacity: 1;
    }
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

  /* Codicon definitions */
  ${codiconsIcons}
`;

export default styles;
