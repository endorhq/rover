export interface AgentCredentialFile {
  path: string;
  description: string;
  required: boolean;
}

/** Usage statistics extracted from agent JSON response */
export interface AgentUsageStats {
  tokens?: number;
  cost?: number;
  model?: string;
}

export interface ValidationResult {
  valid: boolean;
  missing: string[];
}

export interface AgentRecoveryResult {
  rawOutput: string;
  notice?: string;
}

export interface AgentErrorRecoveryContext {
  error: unknown;
  prompt: string;
}

export interface Agent {
  name: string;
  binary: string;
  acpCommand: string;
  version: string;

  getRequiredCredentials(): AgentCredentialFile[];
  validateCredentials(): ValidationResult;
  getInstallCommand(): string;
  install(): Promise<void>;
  configureMCP(
    name: string,
    commandOrUrl: string,
    transport: string,
    envs: string[],
    headers: string[]
  ): Promise<void>;
  copyCredentials(targetDir: string): Promise<void>;
  isInstalled(): Promise<boolean>;
  toolArguments(): string[];
  toolInteractiveArguments(
    precontext: string,
    initialPrompt?: string
  ): string[];
  recoverFromError?(
    context: AgentErrorRecoveryContext
  ): Promise<AgentRecoveryResult | null> | AgentRecoveryResult | null;
  extractUsageStats?(parsedResponse: unknown): AgentUsageStats | undefined;

  /**
   * Returns directories where this agent writes its own logs.
   * Paths are resolved using $HOME so they work regardless of UID mapping.
   */
  getLogSources(): string[];
}
