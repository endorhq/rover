/**
 * Project root utilities - separated from os.ts to avoid circular dependencies
 * when used by files in the files/ directory.
 *
 * @deprecated This module is deprecated. Use explicit project paths from CLI context instead.
 * Functions in this module will be removed in a future version.
 */
import { Git } from './git.js';

// Cache for project root to avoid redundant Git operations
let projectRootCache: string | null = null;

/**
 * Find the Git repository root directory. Falls back to current working directory
 * if not in a Git repository. Result is cached for the process lifetime to avoid
 * redundant Git subprocess calls.
 *
 * @deprecated Use project path from CLI context instead (e.g., `requireProjectContext().projectPath`).
 * This function relies on process.cwd() and global caching, which breaks multi-project scenarios.
 * This function will be removed in a future version.
 */
export function findProjectRoot(): string {
  if (projectRootCache !== null) {
    return projectRootCache;
  }

  const git = new Git();
  projectRootCache = git.getRepositoryRoot() || process.cwd();
  return projectRootCache;
}

/**
 * Clear the cached project root. Useful for testing or edge cases where
 * the repository root might change during process execution.
 *
 * @deprecated This function exists to support the deprecated `findProjectRoot()` function.
 * Both will be removed in a future version.
 *
 * @example
 * // In tests, clear cache between test cases
 * afterEach(() => clearProjectRootCache());
 *
 * // In long-running processes, clear cache when workspace changes
 * vscode.workspace.onDidChangeWorkspaceFolders(() => clearProjectRootCache());
 */
export function clearProjectRootCache(): void {
  projectRootCache = null;
}
