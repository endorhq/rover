import { ACPAgentBase } from './acp-agent-base.js';
import { findKeychainCredentials } from './index.js';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { fileSync } from 'tmp';

// Environment variables reference:
// - https://cursor.com/docs/cli/reference/parameters
const CURSOR_ENV_VARS = [
  // API key
  'CURSOR_API_KEY',
];

// macOS Keychain items for Cursor
const CURSOR_KEYCHAIN_ITEMS = ['cursor-access-token', 'cursor-refresh-token'];

class CursorAI extends ACPAgentBase {
  readonly AGENT_BIN = 'cursor-agent';
  readonly AGENT_NAME = 'cursor';

  getContainerMounts(): string[] {
    const dockerMounts: string[] = [];

    const cursorDirectory = join(homedir(), '.cursor');
    if (existsSync(cursorDirectory)) {
      dockerMounts.push(`-v`, `${cursorDirectory}:/.cursor:Z,ro`);
    }

    const cursorAuthDirectory = join(homedir(), '.config', 'cursor');
    if (existsSync(cursorAuthDirectory)) {
      dockerMounts.push(`-v`, `${cursorAuthDirectory}:/.config/cursor:Z,ro`);
    } else if (platform() === 'darwin') {
      // On macOS, if .cursor directory doesn't exist but keychain has credentials,
      // create a temporary directory with credentials from keychain
      const accessToken = findKeychainCredentials('cursor-access-token');
      const refreshToken = findKeychainCredentials('cursor-refresh-token');

      if (accessToken || refreshToken) {
        const tmpDir = fileSync({
          mode: 0o600,
          prefix: 'cursor-',
          postfix: '',
        });
        const config: any = {};

        if (accessToken) {
          config.accessToken = accessToken;
        }
        if (refreshToken) {
          config.refreshToken = refreshToken;
        }

        // Write the config file
        const configPath = tmpDir.name;
        writeFileSync(configPath, JSON.stringify(config));

        // Mount the temporary config file
        dockerMounts.push(`-v`, `${configPath}:/.config/cursor/auth.json:Z,ro`);
      }
    }

    return dockerMounts;
  }

  getEnvironmentVariables(): string[] {
    const envVars: string[] = [];

    // Add standard environment variables
    for (const key of CURSOR_ENV_VARS) {
      if (process.env[key] !== undefined) {
        envVars.push('-e', key);
      }
    }

    // On macOS, extract credentials from Keychain and make them available
    if (platform() === 'darwin') {
      for (const keychainItem of CURSOR_KEYCHAIN_ITEMS) {
        const value = findKeychainCredentials(keychainItem);
        if (value) {
          // Convert keychain item name to environment variable name
          // e.g., cursor-access-token -> CURSOR_ACCESS_TOKEN
          const envVarName = keychainItem.toUpperCase().replace(/-/g, '_');
          envVars.push('-e', `${envVarName}=${value}`);
        }
      }
    }

    return envVars;
  }
}

export default CursorAI;
