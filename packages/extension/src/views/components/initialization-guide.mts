import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

export interface InitializationStatus {
    cliInstalled: boolean;
    roverInitialized: boolean;
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

    static styles = css`
        .guide-container {
            padding: 20px;
            max-width: 600px;
            margin: 0 auto;
        }

        .guide-title {
            font-size: 1.4em;
            font-weight: 600;
            margin-bottom: 16px;
            color: var(--vscode-foreground);
        }

        .guide-description {
            margin-bottom: 24px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.5;
        }

        .setup-steps {
            display: flex;
            flex-direction: column;
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
            background-color: var(--vscode-inputValidation-infoBackground);
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
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
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
    `;

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

        const { cliInstalled, roverInitialized, cliVersion, error } = this.status;

        return html`
            <div class="guide-container">
                <div class="guide-title">Welcome to Rover!</div>
                <div class="guide-description">
                    Let's get you set up to collaborate with AI agents and complete tasks efficiently.
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
                                The Rover CLI is required to manage tasks and collaborate with AI agents.
                            </div>

                            ${cliInstalled ? html`
                                <div class="status-indicator status-success">
                                    <span>✓</span>
                                    <span>Rover CLI is installed${cliVersion ? ` (${cliVersion})` : ''}</span>
                                </div>
                            ` : html`
                                <div class="step-actions">
                                    <button
                                        class="action-button"
                                        @click=${this.handleInstallCLI}
                                        ?disabled=${this.isInstalling}
                                    >
                                        ${this.isInstalling ? html`<div class="loading-spinner"></div>` : ''}
                                        Install Rover CLI
                                    </button>
                                    <button
                                        class="action-button secondary"
                                        @click=${this.handleRetryCheck}
                                    >
                                        I installed it manually
                                    </button>
                                </div>
                                ${error ? html`
                                    <div class="error-message">
                                        Error: ${error}
                                    </div>
                                ` : ''}
                            `}
                        </div>
                    </div>

                    <!-- Step 2: Rover Initialization -->
                    <div class="setup-step ${roverInitialized ? 'completed' : cliInstalled ? 'current' : ''}">
                        <div class="step-icon ${roverInitialized ? 'completed' : cliInstalled ? 'current' : 'pending'}">
                            ${roverInitialized ? '✓' : '2'}
                        </div>
                        <div class="step-content">
                            <div class="step-title">Initialize Rover</div>
                            <div class="step-description">
                                Initialize Rover in your workspace to start creating and managing tasks.
                            </div>

                            ${roverInitialized ? html`
                                <div class="status-indicator status-success">
                                    <span>✓</span>
                                    <span>Rover is initialized in this workspace</span>
                                </div>
                            ` : cliInstalled ? html`
                                <div class="step-actions">
                                    <button
                                        class="action-button"
                                        @click=${this.handleInitializeRover}
                                        ?disabled=${this.isInitializing}
                                    >
                                        ${this.isInitializing ? html`<div class="loading-spinner"></div>` : ''}
                                        Initialize Rover
                                    </button>
                                </div>
                            ` : html`
                                <div class="step-description">
                                    Install the CLI first to continue with initialization.
                                </div>
                            `}
                        </div>
                    </div>

                    <!-- Step 3: Ready to Use -->
                    <div class="setup-step ${cliInstalled && roverInitialized ? 'completed' : ''}">
                        <div class="step-icon ${cliInstalled && roverInitialized ? 'completed' : 'pending'}">
                            ${roverInitialized ? '✓' : '3'}
                        </div>
                        <div class="step-content">
                            <div class="step-title">Ready to Go!</div>
                            <div class="step-description">
                                ${roverInitialized
                                    ? 'Rover is set up and ready. You can now create tasks and collaborate with AI agents!'
                                    : 'Once initialized, you\'ll be able to create tasks and start collaborating with AI agents.'}
                            </div>

                            ${cliInstalled && roverInitialized ? html`
                                <div class="status-indicator status-success">
                                    <span>✓</span>
                                    <span>Ready to create your first task!</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}
