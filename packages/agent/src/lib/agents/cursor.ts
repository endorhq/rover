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

  getInstallCommand(): string {
    return `nix build --accept-flake-config github:numtide/nix-ai-tools/${process.env.NIX_AI_TOOLS_REV}#cursor-agent`;
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
        required: true,
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
