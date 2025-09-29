export interface AgentCredentialFile {
  path: string;
  description: string;
  required: boolean;
}

export interface ValidationResult {
  valid: boolean;
  missing: string[];
}

export interface Agent {
  name: string;
  version: string;

  getRequiredCredentials(): AgentCredentialFile[];
  validateCredentials(): ValidationResult;
  getInstallCommand(): string;
  install(): Promise<void>;
  copyCredentials(targetDir: string): Promise<void>;
}
