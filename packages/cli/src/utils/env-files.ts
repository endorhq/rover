import { existsSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Copy environment files from source directory to target directory
 * Copies .env, .env.*, but excludes .env.example
 *
 * @param sourcePath - Source directory path
 * @param targetPath - Target directory path
 * @param jsonMode - Whether to suppress console output
 * @returns boolean indicating success
 */
export const copyEnvironmentFiles = (
  sourcePath: string,
  targetPath: string
): boolean => {
  try {
    if (!existsSync(sourcePath) || !existsSync(targetPath)) {
      return false;
    }

    // Copy specific .env file if it exists
    const envFile = join(sourcePath, '.env');
    if (existsSync(envFile)) {
      const targetEnvFile = join(targetPath, '.env');
      copyFileSync(envFile, targetEnvFile);
    }

    // Find and copy .env.* files (but not .env.example)
    const files = readdirSync(sourcePath);
    const envFiles = files.filter(
      file => file.startsWith('.env.') && file !== '.env.example'
    );

    for (const envFile of envFiles) {
      const sourceEnvFile = join(sourcePath, envFile);
      const targetEnvFile = join(targetPath, envFile);
      copyFileSync(sourceEnvFile, targetEnvFile);
    }

    return true;
  } catch (error) {
    return false;
  }
};
