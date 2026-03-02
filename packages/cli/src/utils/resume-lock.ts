import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERBOSE } from 'rover-core';
import { isProcessAlive } from './process.js';

/** Maximum age (ms) for a lock to be considered valid regardless of PID liveness.
 *  Protects against PID reuse: if the original process crashes and an unrelated
 *  process later gets the same PID, the lock will be treated as stale after this
 *  timeout instead of blocking resume indefinitely.
 */
export const LOCK_STALENESS_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Format the lock file content: "PID:TIMESTAMP" where TIMESTAMP is epoch ms.
 */
export function formatLockContent(pid: number): string {
  return `${pid}:${Date.now()}`;
}

/**
 * Parse lock file content. Supports both legacy "PID" and new "PID:TIMESTAMP" formats.
 */
export function parseLockContent(content: string): {
  pid: number;
  createdAt: number | undefined;
} {
  const parts = content.split(':');
  const pid = parseInt(parts[0], 10);
  const createdAt = parts.length > 1 ? parseInt(parts[1], 10) : undefined;
  return {
    pid,
    createdAt: Number.isFinite(createdAt) ? createdAt : undefined,
  };
}

/**
 * Check whether a resume lock file exists at the given iteration path
 * and its owning PID is still alive (and the lock is not stale).
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
    const { pid, createdAt } = parseLockContent(content);

    // If the lock includes a timestamp and it's older than the staleness
    // threshold, treat as stale regardless of PID liveness (guards against
    // PID reuse by the OS after the original process died).
    if (
      createdAt !== undefined &&
      Date.now() - createdAt >= LOCK_STALENESS_TIMEOUT_MS
    ) {
      return false;
    }

    return isProcessAlive(pid);
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
