import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import colors from 'ansi-colors';
import { AgentCredentialFile } from './types.js';
import { BaseAgent } from './base.js';
import { launch, launchSync } from 'rover-common';
import { mcpJsonSchema } from '../mcp/schema.js';

export class CursorAgent extends BaseAgent {
  name = 'Cursor';
  binary = 'cursor-agent';

  getInstallCommand(): string {
    return `nix build --no-link --accept-flake-config github:numtide/nix-ai-tools/${process.env.NIX_AI_TOOLS_REV}#cursor-agent`;
  }

  getRequiredCredentials(): AgentCredentialFile[] {
    return [
      {
        path: '/.cursor/cli-config.json',
        description: 'Cursor configuration',
        required: false,
      },
      {
        path: '/.config/cursor/auth.json',
        description: 'Cursor authentication',
        required: true,
      },
    ];
  }

  async copyCredentials(targetDir: string): Promise<void> {
    console.log(colors.bold(`\nCopying ${this.name} credentials`));

    this.ensureDirectory(join(targetDir, '.cursor'));
    this.ensureDirectory(join(targetDir, '.config', 'cursor'));

    // Copy existing credential files
    const credentials = this.getRequiredCredentials();
    for (const cred of credentials) {
      if (existsSync(cred.path)) {
        copyFileSync(cred.path, join(targetDir, cred.path));
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
    const configPath = join(homedir(), '.cursor', 'mcp.json');

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

    // Build server configuration based on transport type
    const serverConfig: any = {};

    if (transport === 'stdio') {
      const parts = commandOrUrl.split(' ');
      serverConfig.command = parts[0];
      if (parts.length > 1) {
        serverConfig.args = parts.slice(1);
      }
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
        `Unsupported transport type: ${transport}. Use 'stdio' or 'sse'.`
      );
    }

    // Add or update the server configuration
    config.mcpServers[name] = serverConfig;

    // Ensure the .cursor directory exists
    this.ensureDirectory(join(homedir(), '.cursor'));

    // Write the configuration back to disk
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    console.log(
      colors.green(`✓ MCP server "${name}" configured for ${this.name}`)
    );
  }
}
