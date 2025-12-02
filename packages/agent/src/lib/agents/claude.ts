import {
  existsSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  cpSync,
} from 'node:fs';
import path, { basename, join } from 'node:path';
import colors from 'ansi-colors';
import { AgentCredentialFile } from './types.js';
import { BaseAgent } from './base.js';
import {
  launch,
  requiredClaudeCredentials,
  requiredBedrockCredentials,
  requiredVertexAiCredentials,
} from 'rover-common';

export class ClaudeAgent extends BaseAgent {
  name = 'Claude';
  binary = 'claude';

  getInstallCommand(): string {
    const packageSpec = `@anthropic-ai/claude-code@${this.version}`;
    return `npm install -g ${packageSpec}`;
  }

  getRequiredCredentials(): AgentCredentialFile[] {
    let requiredCredentials: AgentCredentialFile[] = [
      {
        path: '/.claude.json',
        description: 'Claude configuration',
        required: true,
      },
    ];

    if (requiredBedrockCredentials()) {
      // TODO: mount bedrock credentials
    }

    if (requiredClaudeCredentials()) {
      requiredCredentials.push({
        path: '/.credentials.json',
        description: 'Claude credentials',
        required: true,
      });
    }

    if (requiredVertexAiCredentials()) {
      requiredCredentials.push({
        path: '/.config/gcloud',
        description: 'Google Cloud credentials',
        required: true,
      });
    }

    return requiredCredentials;
  }

  async copyCredentials(targetDir: string): Promise<void> {
    console.log(colors.bold(`\nCopying ${this.name} credentials`));

    const targetClaudeDir = join(targetDir, '.claude');
    console.log(colors.gray(`├── Target directory: ${targetClaudeDir}`));
    // Ensure .claude directory exists
    this.ensureDirectory(targetClaudeDir);

    const credentials = this.getRequiredCredentials();

    for (const cred of credentials) {
      if (existsSync(cred.path)) {
        const filename = basename(cred.path);

        // For .claude.json, we need to edit the projects section
        if (cred.path.includes('.claude.json')) {
          console.log(colors.gray('├── Processing .claude.json'));

          // Read the config and clear the projects object
          const config = JSON.parse(readFileSync(cred.path, 'utf-8'));
          config.projects = {};

          // Write to targetDir instead of targetClaudeDir.
          // The .claude.json file is located at $HOME
          writeFileSync(
            join(targetDir, filename),
            JSON.stringify(config, null, 2)
          );
          console.log(
            colors.gray('├── Copied: ') +
              colors.cyan('.claude.json (projects cleared)')
          );
        } else if (cred.path.includes('gcloud')) {
          // Copy the entire folder
          cpSync(cred.path, join(targetDir, '.config', 'gcloud'), {
            recursive: true,
          });
          console.log(colors.gray('├── Copied: ') + colors.cyan(cred.path));
        } else {
          // Copy file right away
          copyFileSync(cred.path, join(targetClaudeDir, filename));
          console.log(colors.gray('├── Copied: ') + colors.cyan(cred.path));
        }
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

    // Prepend this to other options to avoid issues with the command.
    // Since execa add quotes to '--env=A=B', if we add the name after,
    // the Claude CLI ignores it.
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

    // @see https://docs.claude.com/en/docs/claude-code/mcp#installing-mcp-servers
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
    return ['--dangerously-skip-permissions', '--output-format', 'json', '-p'];
  }

  toolInteractiveArguments(
    precontext: string,
    initialPrompt?: string
  ): string[] {
    const args = [
      // In this case, let's use the "default approach" and allow agent asking for permissionsk
      '--append-system-prompt',
      precontext,
    ];

    if (initialPrompt) {
      args.push(initialPrompt);
    }

    return args;
  }
}
