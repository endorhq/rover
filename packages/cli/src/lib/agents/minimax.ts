import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ACPAgentBase } from './acp-agent-base.js';

const MINIMAX_ENV_VARS = [
  'MINIMAX_API_KEY',
  'MINIMAX_API_BASE',
  'MINIMAX_PROVIDER',
];

class MiniMaxAI extends ACPAgentBase {
  readonly AGENT_BIN = 'mini-agent';
  readonly AGENT_NAME = 'minimax';

  getContainerMounts(): string[] {
    const miniMaxFolder = join(homedir(), '.mini-agent');
    return existsSync(miniMaxFolder)
      ? ['-v', `${miniMaxFolder}:/.mini-agent:Z,ro`]
      : [];
  }

  getEnvironmentVariables(): string[] {
    const envVars: string[] = [];
    const addedKeys = new Set<string>();

    for (const key in process.env) {
      if (key.startsWith('MINIMAX_') && !addedKeys.has(key)) {
        envVars.push('-e', key);
        addedKeys.add(key);
      }
    }

    for (const key of MINIMAX_ENV_VARS) {
      if (process.env[key] !== undefined && !addedKeys.has(key)) {
        envVars.push('-e', key);
        addedKeys.add(key);
      }
    }

    return envVars;
  }
}

export default MiniMaxAI;
