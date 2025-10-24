import { existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import colors from 'ansi-colors';
import { AgentCredentialFile } from './types.js';
import { BaseAgent } from './base.js';
import { launch } from 'rover-common';

export class QwenAgent extends BaseAgent {
  name = 'Qwen';
  binary = 'qwen';

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

  async configureMCP(
    name: string,
    commandOrUrl: string,
    transport: string,
    envs: string[],
    headers: string[]
  ): Promise<void> {
    const args = [
      'mcp',
      'add',
      '--transport',
      transport,
      '--trust', // Trust the server (bypass all tool call confirmation prompts)
      '--scope',
      'user', // Save it at user level to prevent adding files to the repo
    ];

    // Some fun stuff. In Gemini, the --env options must be at the end of the command.
    // Even after the arguments for the target MCP command.
    //
    // This works: gemini mcp add rover-mcp npx -y @endorhq/rover mcp -e MY_VAR=VALUE
    // This does not work: gemini mcp add -e MY_VAR=VALUE rover-mcp npx -y @endorhq/rover mcp
    //
    // @https://github.com/google-gemini/gemini-cli/issues/10387
    args.push(name, ...commandOrUrl.split(' '));

    envs.forEach(env => {
      if (/\w+=\w+/.test(env)) {
        args.push(`--env=${env}`);
      } else {
        console.log(
          colors.yellow(
            ` Invalid ${env} environment variable.Use KEY = VALUE format`
          )
        );
      }
    });

    headers.forEach(header => {
      if (/[\w\-]+\s*:\s*\w+/.test(header)) {
        args.push('-H', header);
      } else {
        console.log(
          colors.yellow(` Invalid ${header} header. Use "KEY: VALUE" format`)
        );
      }
    });

    const result = await launch(this.binary, args);

    if (result.exitCode !== 0) {
      throw new Error(
        `There was an error adding the ${name} MCP server to ${this.name}.\n${result.stderr}`
      );
    }
  }
}
