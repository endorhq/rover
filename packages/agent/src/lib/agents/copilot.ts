import {
  existsSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  cpSync,
} from 'node:fs';
import path, { basename, join } from 'node:path';
import colors from 'ansi-colors';
import { AgentCredentialFile } from './types.js';
import { BaseAgent } from './base.js';
import { launch } from 'rover-common';

export class CopilotAgent extends BaseAgent {
  name = 'GitHub Copilot';
  binary = 'copilot';

  getInstallCommand(): string {
    // Install GitHub Copilot CLI standalone
    return 'npm install -g @github/copilot';
  }

  getRequiredCredentials(): AgentCredentialFile[] {
    const credentials: AgentCredentialFile[] = [];

    // GitHub Copilot CLI config directory
    const copilotConfigDir = join(process.env.HOME || '~', '.copilot');
    if (existsSync(copilotConfigDir)) {
      credentials.push({
        path: copilotConfigDir,
        description: 'GitHub Copilot CLI configuration directory',
        required: true,
      });
    }

    return credentials;
  }

  async copyCredentials(targetDir: string): Promise<void> {
    console.log(colors.bold(`\nCopying ${this.name} credentials`));

    const targetCopilotDir = join(targetDir, '.copilot');
    console.log(colors.gray(`├── Target directory: ${targetCopilotDir}`));
    
    // Ensure .copilot directory exists
    this.ensureDirectory(targetCopilotDir);

    const credentials = this.getRequiredCredentials();

    for (const cred of credentials) {
      if (existsSync(cred.path)) {
        const stat = lstatSync(cred.path);
        
        if (stat.isDirectory()) {
          // Copy the entire directory
          cpSync(cred.path, targetCopilotDir, { recursive: true });
          console.log(colors.gray('├── Copied: ') + colors.cyan(cred.path));
        } else {
          // Copy individual file
          const filename = basename(cred.path);
          copyFileSync(cred.path, join(targetCopilotDir, filename));
          console.log(colors.gray('├── Copied: ') + colors.cyan(cred.path));
        }
      } else {
        console.log(colors.yellow(`├── Warning: ${cred.path} not found`));
      }
    }

    console.log(colors.green(`✓ ${this.name} credentials copied successfully`));
  }

  async configureMCP(
    name: string,
    commandOrUrl: string,
    transport: string,
    envs: string[],
    headers: string[]
  ): Promise<void> {
    // GitHub Copilot CLI doesn't support MCP (Model Context Protocol) configuration
    // This is a no-op for Copilot
    console.log(colors.yellow(`MCP configuration is not supported for ${this.name}`));
  }

  async isInstalled(): Promise<boolean> {
    try {
      // Check if GitHub Copilot CLI is installed
      const copilotResult = await launch(this.binary, ['--version']);
      return copilotResult.exitCode === 0;
    } catch (error) {
      return false;
    }
  }
}
