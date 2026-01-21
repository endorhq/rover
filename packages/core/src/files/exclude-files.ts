/**
 * File exclusion utility for removing files matching glob patterns from a directory
 */

import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import picomatch from 'picomatch';

/**
 * Result of the removeExcludedFiles operation
 */
export interface RemoveExcludedFilesResult {
  /** List of file paths that were removed (relative to targetPath) */
  removed: string[];
  /** List of errors that occurred during removal */
  errors: string[];
}

/**
 * Recursively collects all files in a directory
 * @param dir - Directory to walk
 * @param basePath - Base path for relative path calculation
 * @param files - Accumulator for files
 */
function walkDirectory(dir: string, basePath: string, files: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(basePath, fullPath);

    if (entry.isDirectory()) {
      // Recursively walk subdirectories
      walkDirectory(fullPath, basePath, files);
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
}

/**
 * Remove files from a directory that match the given glob patterns
 * @param targetPath - The directory to process
 * @param patterns - Array of glob patterns to match against
 * @returns Result containing lists of removed files and errors
 */
export function removeExcludedFiles(
  targetPath: string,
  patterns: string[]
): RemoveExcludedFilesResult {
  const result: RemoveExcludedFilesResult = {
    removed: [],
    errors: [],
  };

  if (!patterns || patterns.length === 0) {
    return result;
  }

  // Create a matcher function from all patterns
  const isMatch = picomatch(patterns);

  // Collect all files in the directory
  const files: string[] = [];
  try {
    walkDirectory(targetPath, targetPath, files);
  } catch (err) {
    result.errors.push(`Failed to walk directory: ${err}`);
    return result;
  }

  // Check each file against the patterns and remove matches
  for (const relativePath of files) {
    if (isMatch(relativePath)) {
      const fullPath = join(targetPath, relativePath);
      try {
        rmSync(fullPath, { force: true });
        result.removed.push(relativePath);
      } catch (err) {
        result.errors.push(`Failed to remove ${relativePath}: ${err}`);
      }
    }
  }

  // Clean up empty directories after file removal
  cleanEmptyDirectories(targetPath, targetPath);

  return result;
}

/**
 * Recursively remove empty directories
 * @param dir - Directory to check
 * @param basePath - Base path to not delete
 */
function cleanEmptyDirectories(dir: string, basePath: string): boolean {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    // First, recursively clean subdirectories
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = join(dir, entry.name);
        cleanEmptyDirectories(subDir, basePath);
      }
    }

    // After cleaning subdirectories, check if this directory is now empty
    const remainingEntries = readdirSync(dir);
    if (remainingEntries.length === 0 && dir !== basePath) {
      rmSync(dir, { recursive: true, force: true });
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
