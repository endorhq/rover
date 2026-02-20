import { existsSync, mkdirSync } from 'node:fs';
import colors from 'ansi-colors';
import { launch, launchSync, showTitle, showProperties } from 'rover-core';
import {
  Agent,
  AgentCredentialFile,
  AgentUsageStats,
  ValidationResult,
} from './types.js';

export abstract class BaseAgent implements Agent {
  abstract name: string;
  abstract binary: string;
  version: string;
  model?: string;

  get acpCommand(): string {
    return this.binary;
  }

  constructor(version: string = 'latest', model?: string) {
    this.version = version;
    this.model = model;
  }

  abstract getRequiredCredentials(): AgentCredentialFile[];
  abstract getInstallCommand(): string;
  abstract copyCredentials(targetDir: string): Promise<void>;
  abstract configureMCP(
    name: string,
    commandOrUrl: string,
    transport: string,
    envs: string[],
    headers: string[]
  ): Promise<void>;
  abstract toolArguments(): string[];
  abstract toolInteractiveArguments(
    precontext: string,
    initialPrompt?: string
  ): string[];

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

    showTitle(`Installing ${this.name} CLI`);
    showProperties({
      Version: colors.cyan(this.version),
      Command: colors.cyan(command),
    });

    try {
      // Run the command in a shell so that pipes and other shell features work
      const result = launchSync('sh', ['-c', command], { stdio: 'inherit' });

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

  async isInstalled(): Promise<boolean> {
    const result = await launch(this.binary, ['--version']);

    return result.exitCode === 0;
  }

  /**
   * Extract usage statistics from the agent's JSON response.
   * Override in subclasses to implement agent-specific parsing.
   * @param _parsedResponse The parsed JSON response from the agent
   * @returns Usage statistics or undefined if not supported
   */
  extractUsageStats(_parsedResponse: unknown): AgentUsageStats | undefined {
    return undefined;
  }

  getLogSources(): string[] {
    return [];
  }
}
