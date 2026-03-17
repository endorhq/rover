import { ACPAgentBase } from './acp-agent-base.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Environment variables reference:
// - https://raw.githubusercontent.com/openai/codex/refs/heads/main/docs/config.md
const CODEX_ENV_VARS = [
  // Azure OpenAI configuration
  'AZURE_OPENAI_API_KEY',

  // OpenTelemetry configuration
  'OTLP_TOKEN',

  // CI/CD configuration
  'CI',
];

class CodexAI extends ACPAgentBase {
  readonly AGENT_BIN = 'codex';
  readonly AGENT_NAME = 'codex';

  getContainerMounts(): string[] {
    const dockerMounts: string[] = [];
    const codexFolder = join(homedir(), '.codex');

    // Only mount if the folder exists
    if (existsSync(codexFolder)) {
      dockerMounts.push(`-v`, `${codexFolder}:/.codex:Z,ro`);
    }

    return dockerMounts;
  }

  getEnvironmentVariables(): string[] {
    const envVars: string[] = [];

    // Look for any CODEX_* and OPENAI_* env vars
    for (const key in process.env) {
      if (key.startsWith('CODEX_') || key.startsWith('OPENAI_')) {
        envVars.push('-e', key);
      }
    }

    // Add other specific environment variables from CODEX_ENV_VARS
    for (const key of CODEX_ENV_VARS) {
      if (process.env[key] !== undefined) {
        envVars.push('-e', key);
      }
    }

    return envVars;
  }
}

export default CodexAI;
