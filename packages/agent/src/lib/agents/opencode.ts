import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { VERBOSE, showList } from 'rover-core';
import { join } from 'node:path';
import { homedir } from 'node:os';
import colors from 'ansi-colors';
import { AgentCredentialFile, AgentUsageStats } from './types.js';
import { BaseAgent } from './base.js';

export class OpenCodeAgent extends BaseAgent {
  name = 'OpenCode';
  binary = 'opencode';

  constructor(version: string = 'latest', model?: string) {
    super(version, model);
  }

  getInstallCommand(): string {
    return `npm i -g opencode-ai@${this.version}`;
  }

  getRequiredCredentials(): AgentCredentialFile[] {
    // OpenCode stores config in ~/.config/opencode/ directory
    // See: https://opencode.ai/docs/providers/#config
    // OpenCode stores credentials in ~/.local/share/opencode/auth.json
    // See: https://opencode.ai/docs/providers/#credentials
    return [
      {
        path: '/.config/opencode/opencode.json',
        description: 'OpenCode configuration',
        required: false,
      },
      {
        path: '/.config/opencode/opencode.jsonc',
        description: 'OpenCode configuration (with comments)',
        required: false,
      },
      {
        path: '/.local/share/opencode/auth.json',
        description: 'OpenCode credentials',
        required: false,
      },
    ];
  }

  async copyCredentials(targetDir: string): Promise<void> {
    console.log(colors.bold(`\nCopying ${this.name} credentials`));

    // OpenCode stores config in .config/opencode/ directory
    const targetOpenCodeConfigDir = join(targetDir, '.config', 'opencode');
    this.ensureDirectory(targetOpenCodeConfigDir);

    // OpenCode stores credentials in .local/share/opencode/ directory
    const targetOpenCodeDataDir = join(
      targetDir,
      '.local',
      'share',
      'opencode'
    );
    this.ensureDirectory(targetOpenCodeDataDir);

    const credentials = this.getRequiredCredentials();
    const copiedItems: string[] = [];
    for (const cred of credentials) {
      if (existsSync(cred.path)) {
        const filename = cred.path.split('/').pop()!;
        // Determine target directory based on source path
        const targetSubDir = cred.path.includes('.local/share')
          ? targetOpenCodeDataDir
          : targetOpenCodeConfigDir;
        copyFileSync(cred.path, join(targetSubDir, filename));
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
    // OpenCode configures MCP servers via opencode.json config file
    // See: https://opencode.ai/docs/mcp-servers/
    const configPath = join(process.cwd(), 'opencode.json');

    // Read existing config or create new one
    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        config = JSON.parse(content);
      } catch (err) {
        console.log(
          colors.yellow(
            `Warning: Could not parse existing opencode.json, creating new one`
          )
        );
      }
    }

    // Ensure mcp object exists
    if (!config.mcp || typeof config.mcp !== 'object') {
      config.mcp = {};
    }

    const mcpConfig = config.mcp as Record<string, unknown>;

    if (transport === 'stdio') {
      // Local MCP server configuration
      const serverConfig: Record<string, unknown> = {
        type: 'local',
        command: commandOrUrl.split(' '),
        enabled: true,
      };

      // Add environment variables if provided
      if (envs.length > 0) {
        const environment: Record<string, string> = {};
        envs.forEach(env => {
          const match = env.match(/^(\w+)=(.+)$/);
          if (match) {
            environment[match[1]] = match[2];
          } else {
            console.log(
              colors.yellow(
                ` Invalid ${env} environment variable. Use KEY=VALUE format`
              )
            );
          }
        });
        if (Object.keys(environment).length > 0) {
          serverConfig.environment = environment;
        }
      }

      mcpConfig[name] = serverConfig;
    } else {
      // Remote MCP server configuration (http, sse)
      const serverConfig: Record<string, unknown> = {
        type: 'remote',
        url: commandOrUrl,
        enabled: true,
      };

      // Add headers if provided
      if (headers.length > 0) {
        const headersObj: Record<string, string> = {};
        headers.forEach(header => {
          const match = header.match(/^([\w-]+)\s*:\s*(.+)$/);
          if (match) {
            headersObj[match[1]] = match[2].trim();
          } else {
            console.log(
              colors.yellow(
                ` Invalid ${header} header. Use "KEY: VALUE" format`
              )
            );
          }
        });
        if (Object.keys(headersObj).length > 0) {
          serverConfig.headers = headersObj;
        }
      }

      mcpConfig[name] = serverConfig;
    }

    // Write updated config
    try {
      writeFileSync(
        configPath,
        JSON.stringify(config, null, 2) + '\n',
        'utf-8'
      );
      console.log(
        colors.green(`✓ Added MCP server "${name}" to opencode.json`)
      );
    } catch (err) {
      throw new Error(
        `There was an error adding the ${name} MCP server to ${this.name}.\n${err}`
      );
    }
  }

  toolArguments(): string[] {
    const args = ['acp', '--format', 'json'];
    if (this.model) {
      args.push('--model', this.model);
    }
    if (VERBOSE) {
      args.push('--verbose');
    }
    return args;
  }

  toolInteractiveArguments(
    precontext: string,
    initialPrompt?: string
  ): string[] {
    // OpenCode doesn't have --append-system-prompt flag
    // Use --agent flag to specify a custom agent with the context, or pass context as initial message
    // For now, pass the precontext as part of the initial prompt
    // See: https://opencode.ai/docs/cli/
    const args: string[] = [];

    if (initialPrompt) {
      args.push(`${precontext}\n\n${initialPrompt}`);
    } else if (precontext) {
      args.push(precontext);
    }

    return args;
  }

  /**
   * Extract usage statistics from OpenCode's JSON response.
   * Currently returns undefined as OpenCode's JSON output format
   * for usage statistics has not been verified.
   * TODO: Implement once OpenCode's response format is documented.
   */
  override extractUsageStats(
    _parsedResponse: unknown
  ): AgentUsageStats | undefined {
    return undefined;
  }

  override getLogSources(): string[] {
    // OpenCode writes debug logs under ~/.local/share/opencode/log/
    // and session/message data under ~/.local/share/opencode/storage/
    return [
      join(homedir(), '.local', 'share', 'opencode', 'log'),
      join(homedir(), '.local', 'share', 'opencode', 'storage'),
    ];
  }
}
