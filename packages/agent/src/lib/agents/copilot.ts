import { existsSync, copyFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import colors from 'ansi-colors';
import { AgentCredentialFile } from './types.js';
import { BaseAgent } from './base.js';
import { launch } from 'rover-core';

export class CopilotAgent extends BaseAgent {
  name = 'Copilot';
  binary = 'copilot';

  constructor(version: string = 'latest', model?: string) {
    super(version, model);
  }

  getInstallCommand(): string {
    const packageSpec = `@github/copilot@${this.version}`;
    return `npm install -g ${packageSpec}`;
  }

  getRequiredCredentials(): AgentCredentialFile[] {
    return [
      {
        path: '/.copilot',
        description: 'Copilot configuration directory',
        required: true,
      },
    ];
  }

  async copyCredentials(targetDir: string): Promise<void> {
    console.log(colors.bold(`\nCopying ${this.name} credentials`));

    const targetCopilotDir = join(targetDir, '.copilot');
    // Ensure .copilot directory exists
    this.ensureDirectory(targetCopilotDir);

    const credentials = this.getRequiredCredentials();
    for (const cred of credentials) {
      if (existsSync(cred.path)) {
        // Copy the entire .copilot directory
        cpSync(cred.path, targetCopilotDir, { recursive: true });
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
    const args = ['mcp', 'add', '--transport', transport];

    args.push(name);

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

    headers.forEach(header => {
      if (/[\w\-]+\s*:\s*\w+/.test(header)) {
        args.push('-H', header);
      } else {
        console.log(
          colors.yellow(` Invalid ${header} header. Use "KEY: VALUE" format`)
        );
      }
    });

    if (transport === 'stdio') {
      args.push('--', ...commandOrUrl.split(' '));
    } else {
      args.push(commandOrUrl);
    }

    const result = await launch(this.binary, args);

    if (result.exitCode !== 0) {
      throw new Error(
        `There was an error adding the ${name} MCP server to ${this.name}.\n${result.stderr}`
      );
    }
  }

  toolArguments(): string[] {
    const args = ['--dangerously-skip-permissions', '--output-format', 'json'];
    if (this.model) {
      args.push('--model', this.model);
    }
    args.push('-p');
    return args;
  }

  toolInteractiveArguments(
    precontext: string,
    initialPrompt?: string
  ): string[] {
    const args = ['--append-system-prompt', precontext];

    if (initialPrompt) {
      args.push(initialPrompt);
    }

    return args;
  }
}
