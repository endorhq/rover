import { ACPAgentBase } from './acp-agent-base.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Environment variables reference:
// - https://raw.githubusercontent.com/QwenLM/qwen-code/refs/heads/main/docs/cli/configuration.md
const QWEN_ENV_VARS = [
  // Sandbox and debugging
  'GEMINI_SANDBOX',
  'SEATBELT_PROFILE',
  'DEBUG',
  'DEBUG_MODE',
  'BUILD_SANDBOX',

  // General configuration
  'NO_COLOR',
  'CLI_TITLE',
  'CODE_ASSIST_ENDPOINT',

  // Web search configuration
  'TAVILY_API_KEY',
];

class QwenAI extends ACPAgentBase {
  readonly AGENT_BIN = 'qwen';
  readonly AGENT_NAME = 'qwen';

  getContainerMounts(): string[] {
    const dockerMounts: string[] = [];
    const qwenFolder = join(homedir(), '.qwen');

    // Only mount if the folder exists
    if (existsSync(qwenFolder)) {
      dockerMounts.push(`-v`, `${qwenFolder}:/.qwen:Z,ro`);
    }

    return dockerMounts;
  }

  getEnvironmentVariables(): string[] {
    const envVars: string[] = [];

    // Look for any QWEN_* and OPENAI_* env vars
    for (const key in process.env) {
      if (key.startsWith('QWEN_') || key.startsWith('OPENAI_')) {
        envVars.push('-e', key);
      }
    }

    // Add other specific environment variables from QWEN_ENV_VARS
    for (const key of QWEN_ENV_VARS) {
      if (process.env[key] !== undefined) {
        envVars.push('-e', key);
      }
    }

    return envVars;
  }
}

export default QwenAI;
