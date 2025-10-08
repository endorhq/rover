import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import colors from 'ansi-colors';
import { AgentCredentialFile } from './types.js';
import { BaseAgent } from './base.js';
import { launch } from 'rover-common';

export class ClaudeAgent extends BaseAgent {
  name = 'Claude';
  binary = 'claude';

  getInstallCommand(): string {
    const packageSpec = `@anthropic-ai/claude-code@${this.version}`;
    return `npm install -g ${packageSpec}`;
  }

  getRequiredCredentials(): AgentCredentialFile[] {
    return [
      {
        path: '/.claude.json',
        description: 'Claude configuration',
        required: true,
      },
      {
        path: '/.credentials.json',
        description: 'Claude credentials',
        required: true, // It's not required when using env variables
      },
    ];
  }

  async copyCredentials(targetDir: string): Promise<void> {
    console.log(colors.bold(`\nCopying ${this.name} credentials`));

    const targetClaudeDir = join(targetDir, '.claude');
    // Ensure .claude directory exists
    this.ensureDirectory(targetClaudeDir);

    // Process and copy Claude configuration
    if (existsSync('/.claude.json')) {
      console.log(colors.gray('├── Processing .claude.json'));

      // Read the config and clear the projects object
      const config = JSON.parse(readFileSync('/.claude.json', 'utf-8'));
      config.projects = {};

      // Write to target
      writeFileSync(
        join(targetDir, '.claude.json'),
        JSON.stringify(config, null, 2)
      );
      console.log(
        colors.gray('├── Copied: ') +
          colors.cyan('.claude.json (projects cleared)')
      );
    }

    // Copy credentials
    if (existsSync('/.credentials.json')) {
      copyFileSync(
        '/.credentials.json',
        join(targetClaudeDir, '.credentials.json')
      );
      console.log(
        colors.gray('├── Copied: ') + colors.cyan('.credentials.json')
      );
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
      args.push('--', commandOrUrl);
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
}
