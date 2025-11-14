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

  /**
   * Reads a credential from macOS Keychain
   * @param service The keychain service/item name
   * @returns The credential value or null if not found
   */
  private readFromKeychain(service: string): string | null {
    if (platform() !== 'darwin') {
      return null;
    }

    try {
      const { stdout } = launchSync('security', [
        'find-generic-password',
        '-s',
        service,
        '-w',
      ]);
      return stdout?.toString().trim() || null;
    } catch (_err) {
      // Credential not found in keychain
      return null;
    }
  }

  getInstallCommand(): string {
    return `nix build --no-link --accept-flake-config github:numtide/nix-ai-tools/${process.env.NIX_AI_TOOLS_REV}#cursor-agent`;
  }

  getRequiredCredentials(): AgentCredentialFile[] {
    return [
      {
        path: '/.cursor/cli-config.json',
        description: 'Cursor configuration',
        required: true,
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
      const sourcePath = join(homedir(), cred.path);
      if (existsSync(sourcePath)) {
        copyFileSync(sourcePath, join(targetDir, cred.path));
        console.log(colors.gray('├── Copied: ') + colors.cyan(cred.path));
      }
    }

    // On macOS, extract credentials from Keychain
    if (platform() === 'darwin') {
      const accessToken = this.readFromKeychain('cursor-access-token');
      const refreshToken = this.readFromKeychain('cursor-refresh-token');

      if (accessToken || refreshToken) {
        const authData: Record<string, string> = {};
        if (accessToken) {
          authData.accessToken = accessToken;
        }
        if (refreshToken) {
          authData.refreshToken = refreshToken;
        }

        const authPath = join(targetDir, '.config', 'cursor', 'auth.json');

        // Merge with existing auth.json if it exists
        let existingAuth: Record<string, any> = {};
        if (existsSync(authPath)) {
          try {
            existingAuth = JSON.parse(readFileSync(authPath, 'utf-8'));
          } catch (_err) {
            // Invalid JSON, will overwrite
          }
        }

        const mergedAuth = { ...existingAuth, ...authData };
        writeFileSync(authPath, JSON.stringify(mergedAuth, null, 2), 'utf-8');
        console.log(
          colors.gray('├── Extracted from Keychain: ') +
            colors.cyan('cursor tokens')
        );
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
