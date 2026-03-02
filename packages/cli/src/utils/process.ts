/**
 * Check whether a process with the given PID is still alive.
 * Returns true if the process exists (even if we lack permission to signal it).
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // EPERM means the process exists but we are not allowed to signal it.
    if (code === 'EPERM') {
      return true;
    }
    return false;
  }
}
