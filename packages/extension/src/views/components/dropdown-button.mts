import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import codiconsIcons from '../common/codicons.mjs';

export interface DropdownAction {
  action: string;
  label: string;
  icon: string;
  danger?: boolean;
}

@customElement('dropdown-button')
export class DropdownButton extends LitElement {
  @property({ type: Array }) actions: DropdownAction[] = [];
  @property({ type: String }) buttonLabel = 'More';
  @property({ type: String }) buttonIcon = 'ellipsis';
  @property({ type: String }) title = '';
  @state() private showDropdown = false;

  static styles = css`
    :host {
      display: inline-block;
      position: relative;
    }

    .dropdown-container {
      position: relative;
      display: inline-block;
    }

    .dropdown-button {
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

    .dropdown-button:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    .dropdown-button.open {
      background: var(--vscode-toolbar-hoverBackground);
    }

    .dropdown-button .codicon {
      font-size: 14px;
    }

    .dropdown-menu {
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

    .dropdown-item.danger {
      color: var(--vscode-errorForeground);
    }

    .dropdown-item.danger:hover {
      background: rgba(248, 113, 113, 0.1);
    }

    .dropdown-item .codicon {
      font-size: 14px;
      flex-shrink: 0;
    }

    // Codicons
    ${codiconsIcons}
  `;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this.handleDocumentClick.bind(this));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this.handleDocumentClick.bind(this));
  }

  private handleDocumentClick(event: Event) {
    if (!this.contains(event.target as Node)) {
      this.showDropdown = false;
    }
  }

  private toggleDropdown(event: Event) {
    event.stopPropagation();
    this.showDropdown = !this.showDropdown;
  }

  private handleAction(event: Event, action: DropdownAction) {
    event.stopPropagation();
    this.showDropdown = false;

    const customEvent = new CustomEvent('dropdown-action', {
      detail: { action: action.action },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(customEvent);
  }

  render() {
    return html`
      <div class="dropdown-container">
        <button
          class="dropdown-button ${this.showDropdown ? 'open' : ''}"
          @click=${this.toggleDropdown}
          title=${this.title || this.buttonLabel}
        >
          <span class="codicon codicon-${this.buttonIcon}"></span>
          ${this.buttonLabel}
        </button>

        ${this.showDropdown
          ? html`
              <div class="dropdown-menu">
                ${this.actions.map(
                  action => html`
                    <button
                      class="dropdown-item ${action.danger ? 'danger' : ''}"
                      @click=${(e: Event) => this.handleAction(e, action)}
                      title=${action.label}
                    >
                      <span class="codicon codicon-${action.icon}"></span>
                      ${action.label}
                    </button>
                  `
                )}
              </div>
            `
          : ''}
      </div>
    `;
  }
}
