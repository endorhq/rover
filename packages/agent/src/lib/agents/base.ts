import { existsSync, mkdirSync } from 'node:fs';
import colors from 'ansi-colors';
import { launchSync } from 'rover-common';
import { Agent, AgentCredentialFile, ValidationResult } from './types.js';

export abstract class BaseAgent implements Agent {
  abstract name: string;
  version: string;

  constructor(version: string = 'latest') {
    this.version = version;
  }

  abstract getRequiredCredentials(): AgentCredentialFile[];
  abstract getInstallCommand(): string;
  abstract copyCredentials(targetDir: string): Promise<void>;

  protected ensureDirectory(dirPath: string): void {
    try {
      mkdirSync(dirPath, { recursive: true });
    } catch (error: any) {
      // Ignore error if directory already exists
      if (error.code === 'EEXIST') {
        return;
      }
      throw new Error(
        `Failed to create directory ${dirPath}: ${error.message || error}`
      );
    }
  }

  validateCredentials(): ValidationResult {
    const credentials = this.getRequiredCredentials();
    const missing: string[] = [];

    for (const cred of credentials) {
      if (cred.required && !existsSync(cred.path)) {
        missing.push(`${cred.path} (${cred.description})`);
      }
    }

    return { valid: missing.length === 0, missing };
  }

  async install(): Promise<void> {
    const command = this.getInstallCommand();

    console.log(colors.bold(`\nInstalling ${this.name} CLI`));
    console.log(colors.gray('├── Version: ') + colors.cyan(this.version));
    console.log(colors.gray('└── Command: ') + colors.cyan(command));

    try {
      // Parse the command to get the executable and arguments
      const parts = command.split(' ');
      const executable = parts[0];
      const args = parts.slice(1);

      const result = launchSync(executable, args, { stdio: 'inherit' });

      if (result.failed) {
        const errorMessage = result.stderr || result.stdout || 'Unknown error';
        throw new Error(
          `Installation command failed with exit code ${result.exitCode}: ${errorMessage}`
        );
      }

      console.log(colors.green(`✓ ${this.name} CLI installed successfully`));
    } catch (error: any) {
      // Handle execa errors (command not found, permission denied, etc.)
      if (error.exitCode !== undefined) {
        const stderr = error.stderr || '';
        const stdout = error.stdout || '';
        const output = stderr || stdout || error.message;
        throw new Error(
          `Failed to install ${this.name} CLI (exit code ${error.exitCode}): ${output}`
        );
      } else if (error.code === 'ENOENT') {
        throw new Error(
          `Failed to install ${this.name} CLI: Command '${command.split(' ')[0]}' not found. Please ensure it is installed and in PATH.`
        );
      } else {
        throw new Error(
          `Failed to install ${this.name} CLI: ${error.message || error}`
        );
      }
    }
  }
}
