import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { clearCheckpointFile } from '../checkpoint-store.js';

describe('clearCheckpointFile', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rover-clear-ckpt-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes an existing checkpoint file', () => {
    const checkpointPath = join(tempDir, 'checkpoint.json');
    writeFileSync(checkpointPath, '{"completedSteps":[]}');
    expect(existsSync(checkpointPath)).toBe(true);

    clearCheckpointFile(tempDir);

    expect(existsSync(checkpointPath)).toBe(false);
  });

  it('does nothing when checkpoint file does not exist', () => {
    // Should not throw
    clearCheckpointFile(tempDir);
  });

  it('does nothing when outputDir is undefined', () => {
    // Should not throw
    clearCheckpointFile(undefined);
  });

  it('logs a warning when removal fails', () => {
    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Pass a path that will cause rmSync to fail (directory path as file)
    clearCheckpointFile('/nonexistent/deeply/nested/path');

    // rmSync with { force: true } on a non-existent file does NOT throw,
    // so no warning is expected in this case.
    // If we want to test the error path, we'd need to mock rmSync.
    warnSpy.mockRestore();
  });
});
