/**
 * Path utilities for safe path operations
 */
import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Check if a child path is within a parent directory.
 *
 * This function safely validates that childPath is actually within parentPath,
 * preventing path traversal attacks that could bypass simple startsWith() checks.
 *
 * @example
 * isPathWithin('/home/user/project/file.txt', '/home/user/project'); // true
 * isPathWithin('/home/user/other/file.txt', '/home/user/project'); // false
 * isPathWithin('/home/user/project/../other/file.txt', '/home/user/project'); // false
 *
 * @param childPath - The path to check
 * @param parentPath - The parent directory that childPath should be within
 * @returns true if childPath is within parentPath, false otherwise
 */
export function isPathWithin(childPath: string, parentPath: string): boolean {
  // Resolve both paths to handle relative paths and normalize them
  const resolvedChild = resolve(childPath);
  const resolvedParent = resolve(parentPath);

  // Get the relative path from parent to child
  const rel = relative(resolvedParent, resolvedChild);

  // If the relative path:
  // - starts with '..' it means childPath is outside parentPath
  // - is an absolute path, it means they're on different drives (Windows)
  // - is empty, it means they're the same path (which is valid)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}
