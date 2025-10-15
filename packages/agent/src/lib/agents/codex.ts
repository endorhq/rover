import { existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import colors from 'ansi-colors';
import { AgentCredentialFile } from './types.js';
import { BaseAgent } from './base.js';
import { launch } from 'rover-common';

export class CodexAgent extends BaseAgent {
  name = 'Codex';
  binary = 'codex';

  getInstallCommand(): string {
    const packageSpec = `@openai/codex@${this.version}`;
    return `npm install -g ${packageSpec}`;
  }

  getRequiredCredentials(): AgentCredentialFile[] {
    return [
      {
        path: '/.codex/auth.json',
        description: 'Codex authentication',
        required: false,
      },
      {
        path: '/.codex/config.json',
        description: 'Codex configuration (old)',
        required: false,
      },
      {
        path: '/.codex/config.toml',
        description: 'Codex configuration (new)',
        required: false,
      },
    ];
  }

  async copyCredentials(targetDir: string): Promise<void> {
    console.log(colors.bold(`\nCopying ${this.name} credentials`));

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

  async configureMCP(
    name: string,
    commandOrUrl: string,
    transport: string,
    envs: string[],
    headers: string[]
  ): Promise<void> {
    const args = ['mcp', 'add'];

    if (transport !== 'stdio') {
      throw new Error(`${this.name} only supports stdio transport`);
    }

    envs.forEach(env => {
      if (/\w+=\w+/.test(env)) {
        args.push(`--env=${env}`);
      } else {
        console.log(
          colors.yellow(
            ` Invalid ${env} environment variable. Use KEY=VALUE format`
          )
        );
      }
    });

    if (headers.length > 0) {
      console.log(
        colors.yellow(
          ` ${this.name} does not support HTTP or SSE servers. Ignoring headers.`
        )
      );
    }

    args.push(name, commandOrUrl);

    const result = await launch(this.binary, args);

    if (result.exitCode !== 0) {
      throw new Error(
        `There was an error adding the ${name} MCP server to ${this.name}.\n${result.stderr}`
      );
    }
  }
}
