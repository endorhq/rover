import { copyFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import colors from 'ansi-colors';
import { showList } from 'rover-core';
import { BaseAgent } from './base.js';
import {
  getMiniMaxConfigPath,
  getMiniMaxMcpConfigPath,
  MINIMAX_INSTALL_SPEC,
  prepareMiniMaxConfig,
  writeMiniMaxMcpConfig,
} from './minimax-config.js';
import type { AgentCredentialFile } from './types.js';

export class MiniMaxAgent extends BaseAgent {
  name = 'MiniMax';
  binary = 'mini-agent';

  constructor(version: string = 'latest', model?: string) {
    super(version, model);
  }

  getInstallCommand(): string {
    return `uv tool install ${MINIMAX_INSTALL_SPEC}`;
  }

  getRequiredCredentials(): AgentCredentialFile[] {
    return [
      {
        path: getMiniMaxConfigPath('/'),
        description: 'Mini-Agent configuration',
        required: true,
      },
    ];
  }

  async copyCredentials(targetDir: string): Promise<void> {
    console.log(colors.bold(`\nCopying ${this.name} credentials`));

    const sourceConfigPath = getMiniMaxConfigPath('/');
    const targetConfigPath = getMiniMaxConfigPath(targetDir);
    this.ensureDirectory(dirname(targetConfigPath));
    copyFileSync(sourceConfigPath, targetConfigPath);

    const sourceMcpPath = getMiniMaxMcpConfigPath('/');
    if (existsSync(sourceMcpPath)) {
      copyFileSync(sourceMcpPath, getMiniMaxMcpConfigPath(targetDir));
    }

    showList([colors.cyan(sourceConfigPath)]);
    console.log(colors.green(`✓ ${this.name} credentials copied successfully`));
  }

  async configureMCP(
    name: string,
    commandOrUrl: string,
    transport: string,
    envs: string[],
    headers: string[]
  ): Promise<void> {
    writeMiniMaxMcpConfig(
      getMiniMaxMcpConfigPath(),
      name,
      commandOrUrl,
      transport,
      envs,
      headers
    );
    console.log(
      colors.green(`✓ Added MCP server "${name}" to Mini-Agent configuration`)
    );
  }

  override get acpCommand(): string {
    return 'mini-agent-acp';
  }

  toolArguments(): string[] {
    prepareMiniMaxConfig(this.model);
    return [];
  }

  toolInteractiveArguments(
    precontext: string,
    initialPrompt?: string
  ): string[] {
    prepareMiniMaxConfig(this.model);
    const prompt = [precontext, initialPrompt].filter(Boolean).join('\n\n');
    return prompt
      ? ['--workspace', process.cwd(), prompt]
      : ['--workspace', process.cwd()];
  }
}
