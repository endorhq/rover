import { existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import colors from 'ansi-colors';
import { AgentCredentialFile } from './types.js';
import { BaseAgent } from './base.js';

export class CodexAgent extends BaseAgent {
  name = 'Codex';

  getInstallCommand(): string {
    const packageSpec = `@openai/codex@${this.version}`;
    return `npm install -g ${packageSpec}`;
  }

  getRequiredCredentials(): AgentCredentialFile[] {
    return [
      {
        path: '/.codex/auth.json',
        description: 'Codex authentication',
        required: true,
      },
      {
        path: '/.codex/config.json',
        description: 'Codex configuration',
        required: true,
      },
    ];
  }

  async copyCredentials(targetDir: string): Promise<void> {
    console.log(colors.white.bold(`\nCopying ${this.name} credentials`));

    const targetCodexDir = join(targetDir, '.codex');
    // Ensure .codex directory exists
    this.ensureDirectory(targetCodexDir);

    const credentials = this.getRequiredCredentials();
    for (const cred of credentials) {
      if (existsSync(cred.path)) {
        const filename = cred.path.split('/').pop()!;
        copyFileSync(cred.path, join(targetCodexDir, filename));
        console.log(colors.gray('├── Copied: ') + colors.cyan(cred.path));
      }
    }

    console.log(colors.green(`✓ ${this.name} credentials copied successfully`));
  }
}
