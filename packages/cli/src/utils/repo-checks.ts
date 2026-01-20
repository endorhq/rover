import { Git, type GitOptions } from 'rover-core';

/**
 * Check if we're in a git repository
 * @param options - Optional Git options including cwd
 * @returns true if in a git repository, false otherwise
 */
export const isGitRepository = (options?: GitOptions): boolean => {
  const git = new Git(options);
  return git.isGitRepo();
};
