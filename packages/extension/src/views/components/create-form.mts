import { LitElement, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import styles from './create-form.css.mjs';

@customElement('create-form')
export class CreateForm extends LitElement {
  @property({ type: Object }) vscode: any = null;
  @property({ type: Array }) agents: string[] = ['claude'];
  @property({ type: String }) defaultAgent: string = 'claude';
  @property({ type: Array }) branches: string[] = ['main'];
  @property({ type: String }) defaultBranch: string = 'main';
  @property({ type: String }) dropdownDirection: 'auto' | 'up' | 'down' =
    'auto';
  @state() private taskInput = '';
  @state() private creatingTask = false;
  @state() private selectedAgent = '';
  @state() private selectedBranch = '';
  @state() private showAgentDropdown = false;
  @state() private showBranchDropdown = false;
  @state() private agentDropdownDirection: 'up' | 'down' = 'down';
  @state() private branchDropdownDirection: 'up' | 'down' = 'down';
  @state() private errorMessage = '';

  private getAgentsList() {
    return this.agents.map(agent => ({
      id: agent,
      name: this.formatAgentName(agent),
    }));
  }

  private formatAgentName(agent: string): string {
    // Capitalize first letter
    return agent.charAt(0).toUpperCase() + agent.slice(1);
  }

  static styles = styles;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this.handleKeyDown.bind(this));
    document.addEventListener('click', this.handleDocumentClick.bind(this));
    this.addEventListener('task-created', this.handleTaskCreated.bind(this));
    this.addEventListener(
      'task-creation-failed',
      this.handleTaskCreationFailed.bind(this)
    );

    // Set default selected agent and branch
    if (!this.selectedAgent) {
      this.selectedAgent = this.defaultAgent || this.agents[0] || 'claude';
    }
    if (!this.selectedBranch) {
      this.selectedBranch = this.defaultBranch || this.branches[0] || 'main';
    }
  }

  updated(changedProperties: Map<string, any>) {
    super.updated(changedProperties);

    // Update selected agent when defaultAgent changes
    if (changedProperties.has('defaultAgent') && this.defaultAgent) {
      this.selectedAgent = this.defaultAgent;
    }

    // Update selected branch when defaultBranch changes
    if (changedProperties.has('defaultBranch') && this.defaultBranch) {
      this.selectedBranch = this.defaultBranch;
    }

    // Ensure selected agent is still valid when agents list changes
    if (changedProperties.has('agents') && this.agents.length > 0) {
      if (!this.agents.includes(this.selectedAgent)) {
        this.selectedAgent = this.defaultAgent || this.agents[0];
      }
    }

    // Ensure selected branch is still valid when branches list changes
    if (changedProperties.has('branches') && this.branches.length > 0) {
      if (!this.branches.includes(this.selectedBranch)) {
        this.selectedBranch = this.defaultBranch || this.branches[0];
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    // Store bound functions to properly remove them
    const boundKeyDown = this.handleKeyDown.bind(this);
    const boundDocClick = this.handleDocumentClick.bind(this);
    window.removeEventListener('keydown', boundKeyDown);
    document.removeEventListener('click', boundDocClick);
    // For custom events, we don't need to store references as they're component-scoped
    this.removeEventListener('task-created', this.handleTaskCreated.bind(this));
    this.removeEventListener(
      'task-creation-failed',
      this.handleTaskCreationFailed.bind(this)
    );
  }

  private handleDocumentClick(event: Event) {
    // Close dropdowns if clicking outside
    if (!this.contains(event.target as Node)) {
      this.showAgentDropdown = false;
      this.showBranchDropdown = false;
    }
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (event.ctrlKey && event.key === 'Enter') {
      const textarea = this.shadowRoot?.querySelector(
        '.form-textarea'
      ) as HTMLTextAreaElement;
      if (textarea === event.target) {
        this.createTask();
      }
    }
  }

  private createTask() {
    const description = this.taskInput.trim();

    if (!description) {
      return;
    }

    // Clear any previous error and start creating
    this.errorMessage = '';
    this.creatingTask = true;

    if (this.vscode) {
      this.vscode.postMessage({
        command: 'createTask',
        description: description,
        agent: this.selectedAgent,
        branch: this.selectedBranch,
      });
    }
  }

  private handleTaskCreated(event: Event) {
    // Task created successfully, reset the form
    this.taskInput = '';
    this.creatingTask = false;
    this.errorMessage = '';
  }

  private handleTaskCreationFailed(event: Event) {
    // Task creation failed, show error and keep form state
    const customEvent = event as CustomEvent;
    this.creatingTask = false;
    this.errorMessage = customEvent.detail?.error || 'Failed to create task';
  }

  private toggleAgentDropdown(event: Event) {
    event.stopPropagation();
    this.showAgentDropdown = !this.showAgentDropdown;
    this.showBranchDropdown = false;

    if (this.showAgentDropdown) {
      this.agentDropdownDirection = this.calculateDropdownDirection(
        event.currentTarget as HTMLElement
      );
    }
  }

  private toggleBranchDropdown(event: Event) {
    event.stopPropagation();
    this.showBranchDropdown = !this.showBranchDropdown;
    this.showAgentDropdown = false;

    if (this.showBranchDropdown) {
      this.branchDropdownDirection = this.calculateDropdownDirection(
        event.currentTarget as HTMLElement
      );
    }
  }

  private calculateDropdownDirection(button: HTMLElement): 'up' | 'down' {
    if (this.dropdownDirection === 'up') return 'up';
    if (this.dropdownDirection === 'down') return 'down';

    // Auto mode: calculate based on position
    const rect = button.getBoundingClientRect();
    const dropdownHeight = 150; // Approximate dropdown height
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    // If not enough space below and more space above, show on top
    if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
      return 'up';
    }

    return 'down';
  }

  private selectAgent(agentId: string, event: Event) {
    event.stopPropagation();
    this.selectedAgent = agentId;
    this.showAgentDropdown = false;
  }

  private selectBranch(branch: string, event: Event) {
    event.stopPropagation();
    this.selectedBranch = branch;
    this.showBranchDropdown = false;
  }

  private getSelectedAgent() {
    const agentsList = this.getAgentsList();
    return agentsList.find(a => a.id === this.selectedAgent) || agentsList[0];
  }

  render() {
    const selectedAgent = this.getSelectedAgent();

    return html`
      <div class="create-form">
        <h2 class="form-title">Assign a new task to an AI Coding Agent</h2>
        <p class="form-desc">
          Rover will create an isolated environment with a copy of your
          repository to complete this task in background.
        </p>
        <textarea
          class="form-textarea"
          placeholder="Provide detailed instructions for this task"
          .value=${this.taskInput}
          @input=${(e: InputEvent) =>
            (this.taskInput = (e.target as HTMLTextAreaElement).value)}
        ></textarea>

        ${this.errorMessage
          ? html`
              <div class="error-message">
                <i class="codicon codicon-error"></i>
                ${this.errorMessage}
              </div>
            `
          : ''}

        <div class="form-controls">
          <div class="form-controls-left">
            <!-- Agent Dropdown -->
            <div class="dropdown-container">
              <button
                class="dropdown-button"
                @click=${this.toggleAgentDropdown}
                title="Select AI agent"
              >
                <i class="codicon codicon-hubot"></i>
                <span>${selectedAgent.name}</span>
                <i class="codicon codicon-chevron-down"></i>
              </button>

              ${this.showAgentDropdown
                ? html`
                    <div
                      class="dropdown-menu ${this.agentDropdownDirection ===
                      'up'
                        ? 'dropdown-up'
                        : ''}"
                    >
                      ${this.getAgentsList().map(
                        agent => html`
                          <button
                            class="dropdown-item ${agent.id ===
                            this.selectedAgent
                              ? 'selected'
                              : ''}"
                            @click=${(e: Event) =>
                              this.selectAgent(agent.id, e)}
                          >
                            <i class="codicon codicon-hubot"></i>
                            <span>${agent.name}</span>
                            ${agent.id === this.selectedAgent
                              ? html`<i class="codicon codicon-check"></i>`
                              : ''}
                          </button>
                        `
                      )}
                    </div>
                  `
                : ''}
            </div>

            <!-- Branch Dropdown -->
            <div class="dropdown-container">
              <button
                class="dropdown-button"
                @click=${this.toggleBranchDropdown}
                title="Select source branch"
              >
                <i class="codicon codicon-git-branch"></i>
                <span>${this.selectedBranch}</span>
                <i class="codicon codicon-chevron-down"></i>
              </button>

              ${this.showBranchDropdown
                ? html`
                    <div
                      class="dropdown-menu ${this.branchDropdownDirection ===
                      'up'
                        ? 'dropdown-up'
                        : ''}"
                    >
                      ${this.branches.map(
                        branch => html`
                          <button
                            class="dropdown-item ${branch ===
                            this.selectedBranch
                              ? 'selected'
                              : ''}"
                            @click=${(e: Event) => this.selectBranch(branch, e)}
                          >
                            <i class="codicon codicon-git-branch"></i>
                            <span>${branch}</span>
                            ${branch === this.selectedBranch
                              ? html`<i class="codicon codicon-check"></i>`
                              : ''}
                          </button>
                        `
                      )}
                    </div>
                  `
                : ''}
            </div>
          </div>

          <div class="form-controls-right">
            <button
              class="create-button"
              @click=${this.createTask}
              ?disabled=${this.creatingTask || !this.taskInput.trim()}
              title="Create new task (Ctrl+Enter)"
            >
              <i
                class="codicon ${this.creatingTask
                  ? 'codicon-loading spin'
                  : 'codicon-add'}"
              ></i>
              ${this.creatingTask ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
