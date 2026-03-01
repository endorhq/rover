import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isResumeLockActive } from '../resume-lock.js';

describe('isResumeLockActive', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'resume-lock-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns false when no lock file exists', () => {
    expect(isResumeLockActive(tempDir)).toBe(false);
  });

  it('returns true when lock file contains current process PID', () => {
    writeFileSync(join(tempDir, '.resume.lock'), String(process.pid));
    expect(isResumeLockActive(tempDir)).toBe(true);
  });

  it('returns false when lock file contains a dead PID', () => {
    // PID 2147483647 is extremely unlikely to exist
    writeFileSync(join(tempDir, '.resume.lock'), '2147483647');
    expect(isResumeLockActive(tempDir)).toBe(false);
  });

  it('returns false when lock file content is not a valid number', () => {
    writeFileSync(join(tempDir, '.resume.lock'), 'garbage');
    expect(isResumeLockActive(tempDir)).toBe(false);
  });

  it('returns false when lock file is empty', () => {
    writeFileSync(join(tempDir, '.resume.lock'), '');
    expect(isResumeLockActive(tempDir)).toBe(false);
  });

  it('returns false when iteration path does not exist', () => {
    expect(isResumeLockActive(join(tempDir, 'nonexistent'))).toBe(false);
  });

  it('returns false when lock file contains negative PID', () => {
    writeFileSync(join(tempDir, '.resume.lock'), '-1');
    expect(isResumeLockActive(tempDir)).toBe(false);
  });

  it('returns false when lock file contains zero', () => {
    writeFileSync(join(tempDir, '.resume.lock'), '0');
    expect(isResumeLockActive(tempDir)).toBe(false);
  });
});
