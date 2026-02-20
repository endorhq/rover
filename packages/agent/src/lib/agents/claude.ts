import {
  existsSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  cpSync,
} from 'node:fs';
import path, { basename, join } from 'node:path';
import { homedir } from 'node:os';
import colors from 'ansi-colors';
import { AgentCredentialFile, AgentUsageStats } from './types.js';
import { BaseAgent } from './base.js';
import {
  launch,
  requiredClaudeCredentials,
  requiredBedrockCredentials,
  requiredVertexAiCredentials,
  VERBOSE,
  showList,
} from 'rover-core';

export class ClaudeAgent extends BaseAgent {
  name = 'Claude';
  binary = 'claude';

  constructor(version: string = 'latest', model?: string) {
    super(version, model);
  }

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

    // Claude settings.json for user preferences (optional)
    requiredCredentials.push({
      path: '/.settings.json',
      description: 'Claude settings',
      required: false,
    });

    return requiredCredentials;
  }

  async copyCredentials(targetDir: string): Promise<void> {
    console.log(colors.bold(`\nCopying ${this.name} credentials`));

    const targetClaudeDir = join(targetDir, '.claude');
    // Ensure .claude directory exists
    this.ensureDirectory(targetClaudeDir);

    const credentials = this.getRequiredCredentials();
    const copiedItems: string[] = [];

    for (const cred of credentials) {
      if (existsSync(cred.path)) {
        const filename = basename(cred.path);

        // For .claude.json, we need to edit the projects section
        if (cred.path.includes('.claude.json')) {
          // Read the config and clear the projects object
          const config = JSON.parse(readFileSync(cred.path, 'utf-8'));
          config.projects = {};

          // Write to targetDir instead of targetClaudeDir.
          // The .claude.json file is located at $HOME
          writeFileSync(
            join(targetDir, filename),
            JSON.stringify(config, null, 2)
          );
          copiedItems.push(colors.cyan('.claude.json (projects cleared)'));
        } else if (cred.path.includes('gcloud')) {
          // Copy the entire folder
          cpSync(cred.path, join(targetDir, '.config', 'gcloud'), {
            recursive: true,
          });
          copiedItems.push(colors.cyan(cred.path));
        } else if (cred.path.includes('.settings.json')) {
          // Copy settings.json to .claude directory
          copyFileSync(cred.path, join(targetClaudeDir, 'settings.json'));
          copiedItems.push(colors.cyan('settings.json'));
        } else {
          // Copy file right away
          copyFileSync(cred.path, join(targetClaudeDir, filename));
          copiedItems.push(colors.cyan(cred.path));
        }
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

  override get acpCommand(): string {
    return 'npx';
  }

  toolArguments(): string[] {
    return ['-y', '@zed-industries/claude-code-acp'];
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

  /**
   * Extract usage statistics from Claude's JSON response.
   * Parses total_cost_usd, usage tokens, and modelUsage.
   */
  override extractUsageStats(
    parsedResponse: unknown
  ): AgentUsageStats | undefined {
    if (!parsedResponse || typeof parsedResponse !== 'object') {
      return undefined;
    }

    const response = parsedResponse as Record<string, unknown>;
    const usage: AgentUsageStats = {};

    // Extract cost
    if (typeof response.total_cost_usd === 'number') {
      usage.cost = response.total_cost_usd;
    }

    // Extract total tokens from usage object
    if (response.usage && typeof response.usage === 'object') {
      const u = response.usage as Record<string, unknown>;
      const inputTokens =
        typeof u.input_tokens === 'number' ? u.input_tokens : 0;
      const outputTokens =
        typeof u.output_tokens === 'number' ? u.output_tokens : 0;
      const cacheReadTokens =
        typeof u.cache_read_input_tokens === 'number'
          ? u.cache_read_input_tokens
          : 0;
      const cacheCreationTokens =
        typeof u.cache_creation_input_tokens === 'number'
          ? u.cache_creation_input_tokens
          : 0;
      usage.tokens =
        inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
    }

    // Extract model from modelUsage (first key is the model name)
    if (response.modelUsage && typeof response.modelUsage === 'object') {
      const models = Object.keys(response.modelUsage as object);
      if (models.length > 0) {
        usage.model = models[0];
      }
    }

    return usage;
  }

  override getLogSources(): string[] {
    // Claude Code writes conversation JSONL logs under
    // ~/.claude/projects/{mangled-cwd}/. The working directory inside
    // the container is /workspace, so the mangled path is "-workspace".
    return [join(homedir(), '.claude', 'projects', '-workspace')];
  }
}
