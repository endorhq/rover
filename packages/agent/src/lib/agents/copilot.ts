import {
  existsSync,
  copyFileSync,
  cpSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import colors from 'ansi-colors';
import { showList } from 'rover-core';
import { AgentCredentialFile } from './types.js';
import { BaseAgent } from './base.js';
import { VERBOSE } from 'rover-core';

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
    const copiedItems: string[] = [];
    for (const cred of credentials) {
      if (existsSync(cred.path)) {
        // Copy the entire .copilot directory
        cpSync(cred.path, targetCopilotDir, { recursive: true });
        copiedItems.push(colors.cyan(cred.path));
      }
    }

    if (copiedItems.length > 0) {
      showList(copiedItems);
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
    const configPath = join(homedir(), '.copilot', 'mcp-config.json');

    // Read existing config or initialize with empty mcpServers
    let config: { mcpServers: Record<string, any> } = { mcpServers: {} };
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        config = JSON.parse(content);
        if (!config.mcpServers) {
          config.mcpServers = {};
        }
      } catch (error: any) {
        console.log(
          colors.yellow(
            `Warning: Could not parse existing config: ${error.message}`
          )
        );
        config = { mcpServers: {} };
      }
    }

    // Parse environment variables (KEY=VALUE format)
    const env: Record<string, string> = {};
    envs.forEach(envVar => {
      const match = envVar.match(/^(\w+)=(.*)$/);
      if (match) {
        env[match[1]] = match[2];
      } else {
        console.log(
          colors.yellow(
            `Warning: Invalid environment variable format: ${envVar} (expected KEY=VALUE)`
          )
        );
      }
    });

    // Parse headers (KEY: VALUE format)
    const headersObj: Record<string, string> = {};
    headers.forEach(header => {
      const match = header.match(/^([\w-]+)\s*:\s*(.+)$/);
      if (match) {
        headersObj[match[1]] = match[2];
      } else {
        console.log(
          colors.yellow(
            `Warning: Invalid header format: ${header} (expected "KEY: VALUE")`
          )
        );
      }
    });

    const serverConfig: any = {
      tools: ['*'],
    };

    serverConfig.type = transport;

    if (transport === 'stdio') {
      const parts = commandOrUrl.split(' ');
      serverConfig.command = parts[0];
      // Copilot CLI requires 'args' array even if empty
      serverConfig.args = parts.length > 1 ? parts.slice(1) : [];
      if (Object.keys(env).length > 0) {
        serverConfig.env = env;
      }
    } else if (['http', 'sse'].includes(transport)) {
      serverConfig.url = commandOrUrl;
      if (Object.keys(headersObj).length > 0) {
        serverConfig.headers = headersObj;
      }
      if (Object.keys(env).length > 0) {
        serverConfig.env = env;
      }
    } else {
      throw new Error(
        `Unsupported transport type: ${transport}. Use 'stdio', 'http', or 'sse'.`
      );
    }

    // Add or update the server configuration
    config.mcpServers[name] = serverConfig;

    // Ensure the .copilot directory exists
    this.ensureDirectory(join(homedir(), '.copilot'));

    // Write the configuration back to disk
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    console.log(
      colors.green(`✓ MCP server "${name}" configured for ${this.name}`)
    );
  }

  toolArguments(): string[] {
    const args = ['--acp', '--allow-all-tools', '--silent'];
    if (this.model) {
      args.push('--model', this.model);
    }
    if (VERBOSE) {
      args.push('--log-level', 'all');
    }
    return args;
  }

  toolInteractiveArguments(
    precontext: string,
    initialPrompt?: string
  ): string[] {
    let prompt = precontext;

    if (initialPrompt) {
      prompt += `\n\nInitial User Prompt:\n\n${initialPrompt}`;
    }

    return ['-p', prompt];
  }

  override getLogSources(): string[] {
    // Copilot CLI writes session event logs under
    // ~/.copilot/session-state/<session-id>/events.jsonl
    return [join(homedir(), '.copilot', 'session-state')];
  }
}
