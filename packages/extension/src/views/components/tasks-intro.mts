import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

@customElement('tasks-intro')
export class TasksIntro extends LitElement {
    static styles = css`
    .empty-state {
      text-align: center;
      padding: 20px;
      color: var(--vscode-descriptionForeground);
    }
    `;

    // Component UI
    render() {
        return html`
            <div class="empty-state">No tasks found. Create your first task below!</div>
        `;
    }
}