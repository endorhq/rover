import { existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import colors from 'ansi-colors';
import { AgentCredentialFile } from './types.js';
import { BaseAgent } from './base.js';

export class QwenAgent extends BaseAgent {
  name = 'Qwen';

  getInstallCommand(): string {
    const packageSpec = `@qwen-code/qwen-code@${this.version}`;
    return `npm install -g ${packageSpec}`;
  }

  getRequiredCredentials(): AgentCredentialFile[] {
    return [
      {
        path: '/.qwen/installation_id',
        description: 'Qwen installation ID',
        required: true,
      },
      {
        path: '/.qwen/oauth_creds.json',
        description: 'Qwen OAuth credentials',
        required: true,
      },
      {
        path: '/.qwen/settings.json',
        description: 'Qwen settings',
        required: true,
      },
    ];
  }

  async copyCredentials(targetDir: string): Promise<void> {
    console.log(colors.bold(`\nCopying ${this.name} credentials`));

    const targetQwenDir = join(targetDir, '.qwen');
    // Ensure .qwen directory exists
    this.ensureDirectory(targetQwenDir);

    const credentials = this.getRequiredCredentials();
    for (const cred of credentials) {
      if (existsSync(cred.path)) {
        const filename = cred.path.split('/').pop()!;
        copyFileSync(cred.path, join(targetQwenDir, filename));
        console.log(colors.gray('├── Copied: ') + colors.cyan(cred.path));
      }
    }

    console.log(colors.green(`✓ ${this.name} credentials copied successfully`));
  }
}
