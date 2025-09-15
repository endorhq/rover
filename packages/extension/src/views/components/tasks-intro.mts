import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import logo from '../common/logo.svg';

@customElement('tasks-intro')
export class TasksIntro extends LitElement {
  static styles = css`
    .empty-state {
      margin-top: 2rem;
      margin-bottom: 1.5rem;
      color: var(--vscode-descriptionForeground);
    }

    .empty-logo {
      display: block;
      margin: 0 auto 12px;
      height: 42px;
    }

    h2 {
      text-align: center;
      font-size: 1rem;
      margin-bottom: 1.5rem;
      font-weight: 600;
    }

    .empty-list {
      font-style: italic;
      padding-left: 1rem;
    }
  `;

  // Component UI
  render() {
    return html`
      <div class="empty-state">
        <img class="empty-logo" src="${logo}" alt="Rover / Endor logo" />
        <h2>No tasks found</h2>
        <p>
          <b>Create your first task in the form below</b>. Here you have some
          sample instructions you can copy and paste start with:
        </p>
        <ul class="empty-list">
          <li>
            Review my README.md file and find any typo or missing relevant
            section
          </li>
          <li>Add a new GitHub action to build and test my project</li>
          <li>Implement X by adding ...</li>
        </ul>
      </div>
    `;
  }
}
