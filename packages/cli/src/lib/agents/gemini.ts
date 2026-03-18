import { ACPAgentBase } from './acp-agent-base.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Environment variables reference:
// - https://raw.githubusercontent.com/google-gemini/gemini-cli/refs/heads/main/docs/cli/configuration.md
const GEMINI_ENV_VARS = [
  // OpenTelemetry configuration
  'OTLP_GOOGLE_CLOUD_PROJECT',

  // Sandbox and debugging
  'SEATBELT_PROFILE',
  'DEBUG',
  'DEBUG_MODE',

  // General configuration
  'NO_COLOR',
  'CLI_TITLE',
  'CODE_ASSIST_ENDPOINT',
];

class GeminiAI extends ACPAgentBase {
  readonly AGENT_BIN = 'gemini';
  readonly AGENT_NAME = 'gemini';

  getContainerMounts(): string[] {
    const dockerMounts: string[] = [];
    const geminiFolder = join(homedir(), '.gemini');

    // Only mount if the folder exists
    if (existsSync(geminiFolder)) {
      dockerMounts.push(`-v`, `${geminiFolder}:/.gemini:Z,ro`);
    }

    return dockerMounts;
  }

  getEnvironmentVariables(): string[] {
    const envVars: string[] = [];

    // Look for any GEMINI_* and GOOGLE_* env vars
    for (const key in process.env) {
      if (key.startsWith('GEMINI_') || key.startsWith('GOOGLE_')) {
        envVars.push('-e', key);
      }
    }

    // Add other specific environment variables from GEMINI_ENV_VARS
    for (const key of GEMINI_ENV_VARS) {
      if (process.env[key] !== undefined) {
        envVars.push('-e', key);
      }
    }

    return envVars;
  }
}

export default GeminiAI;
