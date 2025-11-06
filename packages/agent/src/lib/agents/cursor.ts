import { existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import colors from 'ansi-colors';
import { AgentCredentialFile } from './types.js';
import { BaseAgent } from './base.js';
import { launch } from 'rover-common';
import { mcpJsonSchema } from '../mcp/schema.js';

export class CursorAgent extends BaseAgent {
  name = 'Cursor';
  binary = 'cursor-agent';

  async install(): Promise<void> {
    console.log(colors.bold(`\nInstalling ${this.name} CLI`));
    console.log(colors.gray('└── Using official Cursor installer'));

    try {
      const result = await launch('/bin/bash', [
        '-c',
        'curl https://cursor.com/install -fsS | bash',
      ]);

      if (result.exitCode !== 0) {
        const errorMessage = result.stderr || result.stdout || 'Unknown error';
        throw new Error(
          `Installation failed with exit code ${result.exitCode}: ${errorMessage}`
        );
      }

      console.log(colors.green(`✓ ${this.name} CLI installed successfully`));
    } catch (error: any) {
      if (error.exitCode !== undefined) {
        const stderr = error.stderr || '';
        const stdout = error.stdout || '';
        const output = stderr || stdout || error.message;
        throw new Error(
          `Failed to install ${this.name} CLI (exit code ${error.exitCode}): ${output}`
        );
      } else if (error.code === 'ENOENT') {
        throw new Error(
          `Failed to install ${this.name} CLI: bash command not found`
        );
      } else {
        throw new Error(
          `Failed to install ${this.name} CLI: ${error.message || error}`
        );
      }
    }
  }

  getRequiredCredentials(): AgentCredentialFile[] {
    return [
      {
        path: '/.cursor/cli-config.json',
        description: 'Cursor configuration',
        required: true,
      },
      {
        path: '/.config/cursor/auth.json',
        description: 'Cursor authentication',
        required: false,
      },
    ];
  }

  async copyCredentials(targetDir: string): Promise<void> {
    console.log(colors.bold(`\nCopying ${this.name} credentials`));

    const targetCursorDir = join(targetDir, '.cursor');
    // Ensure .cursor directory exists
    this.ensureDirectory(targetCursorDir);

    const credentials = this.getRequiredCredentials();
    for (const cred of credentials) {
      if (existsSync(cred.path)) {
        const filename = cred.path.split('/').pop()!;
        copyFileSync(cred.path, join(targetCursorDir, filename));
        console.log(colors.gray('├── Copied: ') + colors.cyan(cred.path));
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
    // TODO
  }
}
