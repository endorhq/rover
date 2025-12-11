import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

/**
 * Get the base Rover directory based on platform
 * - macOS/Linux: ~/.rover
 * - Windows: %APPDATA%/Rover
 */
function getRoverBaseDir(): string {
  const platform = process.platform;

  if (platform === 'win32') {
    // Windows: use %APPDATA%
    const appData = process.env.APPDATA;
    if (!appData) {
      throw new Error('APPDATA environment variable not found on Windows');
    }
    return join(appData, 'Rover');
  }

  // macOS and Linux: use ~/.rover
  return join(homedir(), '.rover');
}

/**
 * Get the Rover cache directory based on platform
 * - macOS/Linux: ~/.rover/cache
 * - Windows: %LOCALAPPDATA%/Rover/cache
 */
export function getCacheDir(): string {
  const platform = process.platform;

  if (platform === 'win32') {
    // Windows: use %LOCALAPPDATA% for cache
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error('LOCALAPPDATA environment variable not found on Windows');
    }
    return join(localAppData, 'Rover', 'cache');
  }

  // macOS and Linux: use ~/.rover/cache
  return join(getRoverBaseDir(), 'cache');
}

/**
 * Get the Rover config directory
 * - macOS/Linux: ~/.rover/config
 * - Windows: %APPDATA%/Rover/config
 */
export function getConfigDir(): string {
  return join(getRoverBaseDir(), 'config');
}

/**
 * Get the Rover data directory
 * - macOS/Linux: ~/.rover/data
 * - Windows: %APPDATA%/Rover/data
 */
export function getDataDir(): string {
  return join(getRoverBaseDir(), 'data');
}

/**
 * Ensure all Rover directories exist with proper permissions
 * Creates directories with mode 0o700 (rwx------)
 */
export function ensureDirectories(): void {
  const directories = [getConfigDir(), getDataDir(), getCacheDir()];

  for (const dir of directories) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  }
}
