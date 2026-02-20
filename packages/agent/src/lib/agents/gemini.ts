import { existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import colors from 'ansi-colors';
import { AgentCredentialFile } from './types.js';
import { BaseAgent } from './base.js';
import { launch, VERBOSE, showList } from 'rover-core';

export class GeminiAgent extends BaseAgent {
  name = 'Gemini';
  binary = 'gemini';

  constructor(version: string = 'latest', model?: string) {
    super(version, model);
  }

  getInstallCommand(): string {
    const packageSpec = `@google/gemini-cli@${this.version}`;
    return `npm install -g ${packageSpec}`;
  }

  getRequiredCredentials(): AgentCredentialFile[] {
    return [
      {
        path: '/.gemini/oauth_creds.json',
        description: 'Gemini OAuth credentials',
        required: true,
      },
      {
        path: '/.gemini/settings.json',
        description: 'Gemini settings',
        required: true,
      },
      {
        path: '/.gemini/user_id',
        description: 'Gemini user ID',
        required: false,
      },
    ];
  }

  async copyCredentials(targetDir: string): Promise<void> {
    console.log(colors.bold(`\nCopying ${this.name} credentials`));

    const targetGeminiDir = join(targetDir, '.gemini');
    // Ensure .gemini directory exists
    this.ensureDirectory(targetGeminiDir);

    const credentials = this.getRequiredCredentials();
    const copiedItems: string[] = [];
    for (const cred of credentials) {
      if (existsSync(cred.path)) {
        const filename = cred.path.split('/').pop()!;
        copyFileSync(cred.path, join(targetGeminiDir, filename));
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
            ` Invalid ${env} environment variable. Use KEY = VALUE format`
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

  toolArguments(): string[] {
    const args = ['--experimental-acp', '--include-directories', '/', '--yolo'];
    if (this.model) {
      args.push('--model', this.model);
    }
    if (VERBOSE) {
      args.push('--debug');
    }
    return args;
  }

  toolInteractiveArguments(
    precontext: string,
    initialPrompt?: string
  ): string[] {
    const preamble = this.getPromptPreamble();
    let prompt = preamble;

    if (precontext) {
      prompt += `\n\n${precontext}`;
    }

    if (initialPrompt) {
      prompt += `\n\nInitial User Prompt:\n\n${initialPrompt}`;
    }

    return ['-i', prompt];
  }

  override getPromptPreamble(): string {
    return 'The project root is at /workspace.';
  }

  override getLogSources(): string[] {
    // Gemini CLI writes conversation JSONL logs under
    // ~/.gemini/projects/{mangled-cwd}/. The working directory inside
    // the container is /workspace, so the mangled path is "-workspace".
    return [join(homedir(), '.gemini', 'projects', '-workspace')];
  }
}
