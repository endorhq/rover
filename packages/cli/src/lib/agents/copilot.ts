import { ACPAgentBase } from './acp-agent-base.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Environment variables for GitHub Copilot CLI
const COPILOT_ENV_VARS = ['GITHUB_TOKEN', 'GH_TOKEN'];

class CopilotAI extends ACPAgentBase {
  readonly AGENT_BIN = 'copilot';
  readonly AGENT_NAME = 'copilot';

  getContainerMounts(): string[] {
    const dockerMounts: string[] = [];
    const copilotDir = join(homedir(), '.copilot');

    if (existsSync(copilotDir)) {
      dockerMounts.push(`-v`, `${copilotDir}:/.copilot:Z,ro`);
    }

    return dockerMounts;
  }

  getEnvironmentVariables(): string[] {
    const envVars: string[] = [];

    // Look for COPILOT_* and GITHUB_* env vars
    for (const key in process.env) {
      if (key.startsWith('COPILOT_') || key.startsWith('GITHUB_')) {
        envVars.push('-e', key);
      }
    }

    // Add other specific environment variables
    for (const key of COPILOT_ENV_VARS) {
      if (process.env[key] !== undefined) {
        envVars.push('-e', key);
      }
    }

    return envVars;
  }
}

export default CopilotAI;
