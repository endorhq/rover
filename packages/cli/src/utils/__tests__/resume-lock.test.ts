import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  isResumeLockActive,
  formatLockContent,
  parseLockContent,
} from '../resume-lock.js';

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

  it('returns true when lock file contains current process PID with timestamp', () => {
    writeFileSync(
      join(tempDir, '.resume.lock'),
      formatLockContent(process.pid)
    );
    expect(isResumeLockActive(tempDir)).toBe(true);
  });

  it('returns true when lock file contains legacy PID-only format', () => {
    writeFileSync(join(tempDir, '.resume.lock'), String(process.pid));
    expect(isResumeLockActive(tempDir)).toBe(true);
  });

  it('returns false when lock file contains a dead PID', () => {
    // PID 2147483647 is extremely unlikely to exist
    writeFileSync(join(tempDir, '.resume.lock'), `2147483647:${Date.now()}`);
    expect(isResumeLockActive(tempDir)).toBe(false);
  });

  it('returns false when lock is older than staleness timeout even if PID is alive', () => {
    const thirtyOneMinutesAgo = Date.now() - 31 * 60 * 1000;
    writeFileSync(
      join(tempDir, '.resume.lock'),
      `${process.pid}:${thirtyOneMinutesAgo}`
    );
    expect(isResumeLockActive(tempDir)).toBe(false);
  });

  it('returns true when lock is within staleness timeout and PID is alive', () => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    writeFileSync(
      join(tempDir, '.resume.lock'),
      `${process.pid}:${fiveMinutesAgo}`
    );
    expect(isResumeLockActive(tempDir)).toBe(true);
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

describe('parseLockContent', () => {
  it('parses PID:TIMESTAMP format', () => {
    const result = parseLockContent('12345:1700000000000');
    expect(result.pid).toBe(12345);
    expect(result.createdAt).toBe(1700000000000);
  });

  it('parses legacy PID-only format', () => {
    const result = parseLockContent('12345');
    expect(result.pid).toBe(12345);
    expect(result.createdAt).toBeUndefined();
  });

  it('returns NaN pid for garbage input', () => {
    const result = parseLockContent('garbage');
    expect(Number.isNaN(result.pid)).toBe(true);
  });
});
