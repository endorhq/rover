import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Separate describe blocks: the first uses real fs for happy-path tests,
// the second uses a module mock for the error path (rmSync is non-configurable).

describe('clearCheckpointFile', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rover-clear-ckpt-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('removes an existing checkpoint file', async () => {
    const { clearCheckpointFile } = await import('../checkpoint-store.js');
    const checkpointPath = join(tempDir, 'checkpoint.json');
    writeFileSync(checkpointPath, '{"completedSteps":[]}');
    expect(existsSync(checkpointPath)).toBe(true);

    clearCheckpointFile(tempDir);

    expect(existsSync(checkpointPath)).toBe(false);
  });

  it('does nothing when checkpoint file does not exist', async () => {
    const { clearCheckpointFile } = await import('../checkpoint-store.js');
    // Should not throw
    clearCheckpointFile(tempDir);
  });

  it('does nothing when outputDir is undefined', async () => {
    const { clearCheckpointFile } = await import('../checkpoint-store.js');
    // Should not throw
    clearCheckpointFile(undefined);
  });

  it('logs a warning when removal fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Dynamically import to get the real module, then monkey-patch rmSync
    // through the module's internal reference.
    // clearCheckpointFile uses rmSync inside a try/catch, so any Error
    // from rmSync should be caught and logged.
    const { clearCheckpointFile } = await import('../checkpoint-store.js');

    // Create a checkpoint file, then make the directory read-only so
    // rmSync fails with a real OS-level error.
    const checkpointPath = join(tempDir, 'checkpoint.json');
    writeFileSync(checkpointPath, '{}');

    const { chmodSync } = await import('node:fs');
    chmodSync(tempDir, 0o444);

    try {
      clearCheckpointFile(tempDir);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to clear checkpoint')
      );
    } finally {
      chmodSync(tempDir, 0o755);
      errorSpy.mockRestore();
    }
  });
});
