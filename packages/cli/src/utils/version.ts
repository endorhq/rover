import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

let cachedVersion: string | null = null;

export function getVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }

  try {
    // First, try to use createRequire to import package.json
    // This approach works better with bundlers
    const require = createRequire(import.meta.url);
    const packageJson = require('../../package.json');
    cachedVersion = packageJson.version || '0.0.0';
    return cachedVersion as string;
  } catch (error) {
    // Fallback: try to read from file system
    try {
      // Get the directory of the current module
      const currentDir = dirname(fileURLToPath(import.meta.url));

      // Navigate from dist/ back to the project root
      // The built file will be at dist/index.mjs, so we need to go up one level
      const projectRoot = join(currentDir, '..');
      const packageJsonPath = join(projectRoot, 'package.json');

      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      cachedVersion = packageJson.version || '0.0.0';

      return cachedVersion as string;
    } catch (fsError) {
      console.warn('Failed to read version from package.json:', fsError);
      // Fallback version if package.json cannot be read
      cachedVersion = '0.0.0';
      return cachedVersion;
    }
  }
}
