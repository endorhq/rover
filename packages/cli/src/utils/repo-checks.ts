import { Git } from 'rover-core';

/**
 * Check if we're in a git repository
 * @returns true if in a git repository, false otherwise
 */
export const isGitRepository = (): boolean => {
  const git = new Git();
  return git.isGitRepo();
};
