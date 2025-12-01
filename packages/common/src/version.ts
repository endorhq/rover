import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export interface GetVersionOptions {
  packageJsonPath?: string;
  packageRootRelativePath?: string;
  moduleUrl?: string;
}

/**
 * Build a version getter with its own cache so multiple packages can reuse
 * the same logic without sharing state.
 */
export function createGetVersion(
  options: GetVersionOptions = {}
): () => string {
  const {
    packageJsonPath = '../../package.json',
    packageRootRelativePath = '..',
    moduleUrl = import.meta.url,
  } = options;

  let cachedVersion: string | null = null;

  return function getVersion(): string {
    if (cachedVersion) {
      return cachedVersion;
    }

    try {
      const require = createRequire(moduleUrl);
      const packageJson = require(packageJsonPath);
      cachedVersion = packageJson.version || '0.0.0';
      return cachedVersion as string;
    } catch {
      try {
        const currentDir = dirname(fileURLToPath(moduleUrl));
        const projectRoot = join(currentDir, packageRootRelativePath);
        const packageJsonPathFromFs = join(projectRoot, 'package.json');

        const packageJson = JSON.parse(
          readFileSync(packageJsonPathFromFs, 'utf-8')
        );
        cachedVersion = packageJson.version || '0.0.0';

        return cachedVersion as string;
      } catch (fsError) {
        console.warn('Failed to read version from package.json:', fsError);
        cachedVersion = '0.0.0';
        return cachedVersion;
      }
    }
  };
}

export const getVersion = createGetVersion();
