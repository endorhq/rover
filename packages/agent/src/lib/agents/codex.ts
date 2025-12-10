import { existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import colors from 'ansi-colors';
import { AgentCredentialFile } from './types.js';
import { BaseAgent } from './base.js';
import { launch } from 'rover-core';

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

    if (transport === 'stdio') {
      if (headers.length > 0) {
        console.log(
          colors.yellow(` ${this.name} does not support headers in stdio mode.`)
        );
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

      args.push(name, '--', ...commandOrUrl.split(' '));
    } else if (transport === 'http') {
      if (envs.length > 0) {
        console.log(
          colors.yellow(
            ` ${this.name} only supports environment variables in stdio mode.`
          )
        );
      }

      // TODO: allow the user to specify what envvar contains the
      // bearer token.
      //
      // Codex works a bit different here: does not support
      // arbitrary headers at this time but --bearer-token-env-var,
      // the name of an envvar that holds the bearer token.

      if (headers.length > 0) {
        console.log(
          colors.yellow(` ${this.name} does not support arbitrary headers.`)
        );
      }

      args.push(name, '--url', commandOrUrl);
    } else {
      throw new Error(
        `Codex does not support other MCP server transports than stdio or http`
      );
    }

    const result = await launch(this.binary, args);

    if (result.exitCode !== 0) {
      throw new Error(
        `There was an error adding the ${name} MCP server to ${this.name}.\n${result.stderr}`
      );
    }
  }

  toolArguments(): string[] {
    return [
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      '--skip-git-repo-check',
      '-',
    ];
  }

  toolInteractiveArguments(
    precontext: string,
    initialPrompt?: string
  ): string[] {
    let prompt = precontext;

    if (initialPrompt) {
      prompt += `\n\nInitial User Prompt:\n\n${initialPrompt}`;
    }

    return [prompt];
  }
}
