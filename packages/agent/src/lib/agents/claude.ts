import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import colors from 'ansi-colors';
import { AgentCredentialFile } from './types.js';
import { BaseAgent } from './base.js';

export class ClaudeAgent extends BaseAgent {
  name = 'Claude';

  getInstallCommand(): string {
    const packageSpec = `@anthropic-ai/claude-code@${this.version}`;
    return `npm install -g ${packageSpec}`;
  }

  getRequiredCredentials(): AgentCredentialFile[] {
    return [
      {
        path: '/.claude.json',
        description: 'Claude configuration',
        required: true,
      },
      {
        path: '/.credentials.json',
        description: 'Claude credentials',
        required: true,
      },
    ];
  }

  async copyCredentials(targetDir: string): Promise<void> {
    console.log(colors.bold(`\nCopying ${this.name} credentials`));

    const targetClaudeDir = join(targetDir, '.claude');
    // Ensure .claude directory exists
    this.ensureDirectory(targetClaudeDir);

    // Process and copy Claude configuration
    if (existsSync('/.claude.json')) {
      console.log(colors.gray('├── Processing .claude.json'));

      // Read the config and clear the projects object
      const config = JSON.parse(readFileSync('/.claude.json', 'utf-8'));
      config.projects = {};

      // Write to target
      writeFileSync(
        join(targetDir, '.claude.json'),
        JSON.stringify(config, null, 2)
      );
      console.log(
        colors.gray('├── Copied: ') +
          colors.cyan('.claude.json (projects cleared)')
      );
    }

    // Copy credentials
    if (existsSync('/.credentials.json')) {
      copyFileSync(
        '/.credentials.json',
        join(targetClaudeDir, '.credentials.json')
      );
      console.log(
        colors.gray('├── Copied: ') + colors.cyan('.credentials.json')
      );
    }

    console.log(colors.green(`✓ ${this.name} credentials copied successfully`));
  }
}
