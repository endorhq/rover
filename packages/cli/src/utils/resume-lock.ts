import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERBOSE } from 'rover-core';
import { isProcessAlive } from './process.js';

/**
 * Check whether a resume lock file exists at the given iteration path
 * and its owning PID is still alive.
 *
 * Shared between the orphan detector and resume-helper to avoid
 * duplicating lock-checking logic.
 */
export function isResumeLockActive(iterationPath: string): boolean {
  const lockPath = join(iterationPath, '.resume.lock');
  if (!existsSync(lockPath)) {
    return false;
  }

  try {
    const content = readFileSync(lockPath, 'utf8');
    const lockPid = parseInt(content, 10);
    return isProcessAlive(lockPid);
  } catch (err) {
    if (VERBOSE) {
      console.warn(
        `Warning: could not read resume lock file ${lockPath}:`,
        err
      );
    }
    return false;
  }
}
