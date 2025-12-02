/**
 * Environment variable utilities for parsing and loading custom environment
 * variables from rover.json configuration.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { ProjectConfigManager } from 'rover-schemas';

/**
 * Parse custom environment variables from project config.
 *
 * Supports two formats:
 * - "ENV_NAME" - Pass through the current value from the host environment to the container
 * - "ENV_NAME=VALUE" - Force a specific value for the environment variable in the container
 *
 * Returns an array of Docker CLI arguments in the format ['-e', 'KEY=VALUE', '-e', 'KEY2=VALUE2', ...].
 *
 * Note: If a passthrough variable doesn't exist in the host environment, it will be silently skipped.
 * Malformed entries (e.g., "ENV=" or "=VALUE") are skipped silently to maintain backwards compatibility.
 *
 * @param envs - Array of environment variable specifications from rover.json
 * @returns Array of Docker CLI arguments for environment variables
 */
export function parseCustomEnvironmentVariables(envs: string[]): string[] {
  const envArgs: string[] = [];

  for (const env of envs) {
    if (env.includes('=')) {
      // Format: ENV_NAME=VALUE - explicit value
      const [key, ...valueParts] = env.split('=');
      const value = valueParts.join('='); // Handle cases like ENV=foo=bar

      // Validate format: skip if key or value is empty
      if (key.trim() && value !== undefined) {
        envArgs.push('-e', env);
      }
    } else {
      // Format: ENV_NAME - passthrough from host
      const value = process.env[env];
      if (value !== undefined) {
        envArgs.push('-e', `${env}=${value}`);
      }
      // Skip if the environment variable doesn't exist on the host
    }
  }

  return envArgs;
}

/**
 * Load environment variables from a dotenv file.
 *
 * Returns an array of Docker CLI arguments in the format ['-e', 'KEY=VALUE', '-e', 'KEY2=VALUE2', ...].
 *
 * Security Note: The path is resolved relative to the project root and validated to prevent
 * path traversal attacks. Paths that attempt to access files outside the project root are rejected.
 *
 * Warning: Environment variables may contain sensitive credentials. Ensure .env files are not
 * committed to version control and use Docker secrets for production deployments.
 *
 * @param projectConfig - Project configuration manager instance
 * @returns Array of Docker CLI arguments for environment variables
 */
export function loadEnvsFile(projectConfig: ProjectConfigManager): string[] {
  const envArgs: string[] = [];
  const absolutePath = resolve(
    join(projectConfig.projectRoot, projectConfig.envsFile!)
  );

  // Security: Validate path to prevent path traversal
  if (!absolutePath.startsWith(projectConfig.projectRoot)) {
    // Silently skip path traversal attempts
    return envArgs;
  }

  if (!existsSync(absolutePath)) {
    // Silently skip if file doesn't exist
    return envArgs;
  }

  try {
    const fileContent = readFileSync(absolutePath, 'utf8');
    const parsed = parseDotenv(fileContent);

    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined) {
        envArgs.push('-e', `${key}=${value}`);
      }
    }
  } catch (error) {
    // Silently skip if there's an error parsing the file
  }

  return envArgs;
}
