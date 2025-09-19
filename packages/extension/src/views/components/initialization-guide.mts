import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import styles from './initialization-guide.css.mjs';
import logo from '../common/logo.svg';

export interface InitializationStatus {
  cliInstalled: boolean;
  roverInitialized: boolean;
  workspaceOpen: boolean;
  cliVersion?: string;
  error?: string;
}

@customElement('initialization-guide')
export class InitializationGuide extends LitElement {
  @property({ type: Object })
  status?: InitializationStatus;

  @state()
  private isInstalling = false;

  @state()
  private isInitializing = false;

  static styles = styles;

  private handleInstallCLI() {
    this.isInstalling = true;
    this.dispatchEvent(new CustomEvent('install-cli'));

    // Reset installing state after timeout
    setTimeout(() => {
      this.isInstalling = false;
    }, 60000);
  }

  private handleInitializeRover() {
    this.isInitializing = true;
    this.dispatchEvent(new CustomEvent('initialize-rover'));

    // Reset initializing state after timeout
    setTimeout(() => {
      this.isInitializing = false;
    }, 10000);
  }

  private handleRetryCheck() {
    this.dispatchEvent(new CustomEvent('retry-check'));
  }

  // Update status when component receives new status
  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);

    if (changedProperties.has('status') && this.status) {
      // Reset loading states if status changed to installed/initialized
      if (this.status.cliInstalled && this.isInstalling) {
        this.isInstalling = false;
      }
      if (this.status.roverInitialized && this.isInitializing) {
        this.isInitializing = false;
      }
    }
  }

  render() {
    if (!this.status) {
      return html`
        <div class="guide-container">
          <div class="guide-title">Setting up Rover...</div>
          <div class="guide-description">Checking installation status...</div>
        </div>
      `;
    }

    const { cliInstalled, roverInitialized, workspaceOpen, cliVersion, error } =
      this.status;

    return html`
      <div class="guide-container">
        <img class="guide-logo" src="${logo}" alt="Rover / Endor logo" />
        <div class="guide-title">Welcome to Rover!</div>
        <div class="guide-description">
          Rover is a manager for AI coding agents that works with Claude Code,
          Codex, Gemini, and Qwen. It helps you get more done, faster, by
          allowing multiple agents to work on your codebase simultaneously.
        </div>
        <div class="guide-description">
          This guide will help you installing Rover and configuring it in your
          project.
        </div>
        <div class="setup-steps">
          <!-- Step 1: CLI Installation -->
          <div class="setup-step ${cliInstalled ? 'completed' : 'current'}">
            <div class="step-icon ${cliInstalled ? 'completed' : 'current'}">
              ${cliInstalled ? '✓' : '1'}
            </div>
            <div class="step-content">
              <div class="step-title">Install Rover CLI</div>
              <div class="step-description">
                The Rover CLI is required to manage tasks and collaborate with
                AI agents.
              </div>

              ${cliInstalled
                ? html`
                    <div class="status-indicator status-success">
                      <span>✓</span>
                      <span
                        >Rover CLI is
                        installed${cliVersion ? ` (${cliVersion})` : ''}</span
                      >
                    </div>
                  `
                : html`
                    <div class="step-actions">
                      <button
                        class="action-button"
                        @click=${this.handleInstallCLI}
                        ?disabled=${this.isInstalling}
                      >
                        ${this.isInstalling
                          ? html`<div class="loading-spinner"></div>`
                          : ''}
                        Install Rover CLI
                      </button>
                      <button
                        class="action-button secondary"
                        @click=${this.handleRetryCheck}
                      >
                        I installed it manually
                      </button>
                    </div>
                    ${error
                      ? html` <div class="error-message">Error: ${error}</div> `
                      : ''}
                  `}
            </div>
          </div>

          <!-- Step 2: Rover Initialization -->
          <div
            class="setup-step ${roverInitialized
              ? 'completed'
              : cliInstalled
                ? 'current'
                : ''}"
          >
            <div
              class="step-icon ${roverInitialized
                ? 'completed'
                : cliInstalled
                  ? 'current'
                  : 'pending'}"
            >
              ${roverInitialized ? '✓' : '2'}
            </div>
            <div class="step-content">
              <div class="step-title">Initialize Rover</div>
              <div class="step-description">
                Initialize Rover in your current project. It will check the
                available tools and AI Coding Agents in your system.
              </div>

              ${roverInitialized
                ? html`
                    <div class="status-indicator status-success">
                      <span>✓</span>
                      <span>Rover is initialized in this workspace</span>
                    </div>
                  `
                : cliInstalled
                  ? workspaceOpen
                    ? html`
                        <div class="step-actions">
                          <button
                            class="action-button"
                            @click=${this.handleInitializeRover}
                            ?disabled=${this.isInitializing}
                          >
                            ${this.isInitializing
                              ? html`<div class="loading-spinner"></div>`
                              : ''}
                            Initialize Rover
                          </button>
                        </div>
                      `
                    : html`
                        <div class="step-description">
                          Please open a workspace folder to initialize Rover.
                        </div>
                      `
                  : html`
                      <div class="step-description">
                        Install the CLI first to continue with initialization.
                      </div>
                    `}
            </div>
          </div>

          <!-- Step 3: Ready to Use -->
          <div
            class="setup-step ${cliInstalled && roverInitialized
              ? 'completed'
              : ''}"
          >
            <div
              class="step-icon ${cliInstalled && roverInitialized
                ? 'completed'
                : 'pending'}"
            >
              ${roverInitialized ? '✓' : '3'}
            </div>
            <div class="step-content">
              <div class="step-title">Ready to Go!</div>
              <div class="step-description">
                ${roverInitialized
                  ? 'Rover is set up and ready. You can now create tasks and collaborate with AI agents!'
                  : "Once initialized, you'll be able to create tasks and start collaborating with AI agents."}
              </div>

              ${cliInstalled && roverInitialized
                ? html`
                    <div class="status-indicator status-success">
                      <span>✓</span>
                      <span>Ready to create your first task!</span>
                    </div>
                  `
                : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
