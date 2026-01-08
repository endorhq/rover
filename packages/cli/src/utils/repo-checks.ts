import { Git, findProjectRoot, ProjectConfigManager } from 'rover-core';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Check if we're in a git repository
 * @returns true if in a git repository, false otherwise
 */
export const isGitRepository = (): boolean => {
  const git = new Git();
  return git.isGitRepo();
};

/**
 * Check if rover is initialized in the current directory
 * @returns true if rover is initialized, false otherwise
 */
export const isRoverInitialized = (): boolean => {
  try {
    const roverPath = join(findProjectRoot(), '.rover');
    return existsSync(roverPath) && ProjectConfigManager.exists();
  } catch (error) {
    // findProjectRoot throws if .rover directory is not found
    return false;
  }
};
