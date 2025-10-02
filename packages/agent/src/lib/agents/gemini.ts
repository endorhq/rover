import { existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import colors from 'ansi-colors';
import { AgentCredentialFile } from './types.js';
import { BaseAgent } from './base.js';

export class GeminiAgent extends BaseAgent {
  name = 'Gemini';

  getInstallCommand(): string {
    const packageSpec = `@google/gemini-cli@${this.version}`;
    return `npm install -g ${packageSpec}`;
  }

  getRequiredCredentials(): AgentCredentialFile[] {
    return [
      {
        path: '/.gemini/oauth_creds.json',
        description: 'Gemini OAuth credentials',
        required: true,
      },
      {
        path: '/.gemini/settings.json',
        description: 'Gemini settings',
        required: true,
      },
      {
        path: '/.gemini/user_id',
        description: 'Gemini user ID',
        required: true,
      },
    ];
  }

  async copyCredentials(targetDir: string): Promise<void> {
    console.log(colors.bold(`\nCopying ${this.name} credentials`));

    const targetGeminiDir = join(targetDir, '.gemini');
    // Ensure .gemini directory exists
    this.ensureDirectory(targetGeminiDir);

    const credentials = this.getRequiredCredentials();
    for (const cred of credentials) {
      if (existsSync(cred.path)) {
        const filename = cred.path.split('/').pop()!;
        copyFileSync(cred.path, join(targetGeminiDir, filename));
        console.log(colors.gray('├── Copied: ') + colors.cyan(cred.path));
      }
    }

    console.log(colors.green(`✓ ${this.name} credentials copied successfully`));
  }
}
