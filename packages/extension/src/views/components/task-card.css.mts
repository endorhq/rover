import { css } from 'lit';
import codiconsIcons from '../common/codicons.mjs';

const styles = css`
:host {
    display: block;
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