import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeExcludedFiles } from '../exclude-files.js';

describe('removeExcludedFiles', () => {
  let testDir: string;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'rover-exclude-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  /**
   * Helper to create a file with optional content
   */
  function createFile(relativePath: string, content: string = ''): void {
    const fullPath = join(testDir, relativePath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (dir && dir !== testDir) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, content);
  }

  /**
   * Helper to check if a file exists
   */
  function fileExists(relativePath: string): boolean {
    return existsSync(join(testDir, relativePath));
  }

  it('should return empty result when no patterns provided', () => {
    createFile('file1.ts', 'content');
    createFile('file2.ts', 'content');

    const result = removeExcludedFiles(testDir, []);

    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(fileExists('file1.ts')).toBe(true);
    expect(fileExists('file2.ts')).toBe(true);
  });

  it('should remove files matching simple filename pattern', () => {
    createFile('secret.key', 'secret content');
    createFile('normal.ts', 'normal content');

    const result = removeExcludedFiles(testDir, ['secret.key']);

    expect(result.removed).toContain('secret.key');
    expect(result.errors).toEqual([]);
    expect(fileExists('secret.key')).toBe(false);
    expect(fileExists('normal.ts')).toBe(true);
  });

  it('should remove files matching wildcard pattern', () => {
    createFile('config.security.ts', 'content');
    createFile('auth.security.ts', 'content');
    createFile('utils.ts', 'content');

    const result = removeExcludedFiles(testDir, ['*.security.ts']);

    expect(result.removed).toContain('config.security.ts');
    expect(result.removed).toContain('auth.security.ts');
    expect(result.removed).not.toContain('utils.ts');
    expect(result.errors).toEqual([]);
    expect(fileExists('config.security.ts')).toBe(false);
    expect(fileExists('auth.security.ts')).toBe(false);
    expect(fileExists('utils.ts')).toBe(true);
  });

  it('should remove files matching double-star glob pattern', () => {
    createFile('src/security/auth.ts', 'content');
    createFile('src/security/crypto.ts', 'content');
    createFile('src/utils/helper.ts', 'content');

    const result = removeExcludedFiles(testDir, ['**/security/**']);

    expect(result.removed).toContain('src/security/auth.ts');
    expect(result.removed).toContain('src/security/crypto.ts');
    expect(result.removed).not.toContain('src/utils/helper.ts');
    expect(result.errors).toEqual([]);
    expect(fileExists('src/security/auth.ts')).toBe(false);
    expect(fileExists('src/security/crypto.ts')).toBe(false);
    expect(fileExists('src/utils/helper.ts')).toBe(true);
  });

  it('should remove files matching multiple patterns', () => {
    createFile('secret.key', 'content');
    createFile('config.ts', 'content');
    createFile('internal/private.ts', 'content');
    createFile('public/api.ts', 'content');

    const result = removeExcludedFiles(testDir, ['*.key', 'internal/**']);

    expect(result.removed).toContain('secret.key');
    expect(result.removed).toContain('internal/private.ts');
    expect(result.removed).not.toContain('config.ts');
    expect(result.removed).not.toContain('public/api.ts');
    expect(result.errors).toEqual([]);
    expect(fileExists('secret.key')).toBe(false);
    expect(fileExists('internal/private.ts')).toBe(false);
    expect(fileExists('config.ts')).toBe(true);
    expect(fileExists('public/api.ts')).toBe(true);
  });

  it('should handle nested directory patterns', () => {
    createFile('src/components/Button.tsx', 'content');
    createFile('src/components/__tests__/Button.test.tsx', 'content');
    createFile('src/utils/__tests__/helper.test.ts', 'content');

    const result = removeExcludedFiles(testDir, ['**/__tests__/**']);

    expect(result.removed).toContain(
      'src/components/__tests__/Button.test.tsx'
    );
    expect(result.removed).toContain('src/utils/__tests__/helper.test.ts');
    expect(result.removed).not.toContain('src/components/Button.tsx');
    expect(result.errors).toEqual([]);
    expect(fileExists('src/components/__tests__/Button.test.tsx')).toBe(false);
    expect(fileExists('src/utils/__tests__/helper.test.ts')).toBe(false);
    expect(fileExists('src/components/Button.tsx')).toBe(true);
  });

  it('should remove files with specific extension pattern', () => {
    createFile('cert.pem', 'content');
    createFile('key.pem', 'content');
    createFile('config.json', 'content');

    const result = removeExcludedFiles(testDir, ['**/*.pem']);

    expect(result.removed).toContain('cert.pem');
    expect(result.removed).toContain('key.pem');
    expect(result.removed).not.toContain('config.json');
    expect(result.errors).toEqual([]);
    expect(fileExists('cert.pem')).toBe(false);
    expect(fileExists('key.pem')).toBe(false);
    expect(fileExists('config.json')).toBe(true);
  });

  it('should handle exact file path patterns', () => {
    createFile('scripts/security-check.ts', 'content');
    createFile('scripts/build.ts', 'content');

    const result = removeExcludedFiles(testDir, ['scripts/security-check.ts']);

    expect(result.removed).toContain('scripts/security-check.ts');
    expect(result.removed).not.toContain('scripts/build.ts');
    expect(result.errors).toEqual([]);
    expect(fileExists('scripts/security-check.ts')).toBe(false);
    expect(fileExists('scripts/build.ts')).toBe(true);
  });

  it('should clean up empty directories after file removal', () => {
    createFile('internal/security/auth.ts', 'content');
    createFile('internal/security/crypto.ts', 'content');
    createFile('internal/public/api.ts', 'content');

    const result = removeExcludedFiles(testDir, ['internal/security/**']);

    expect(result.removed).toContain('internal/security/auth.ts');
    expect(result.removed).toContain('internal/security/crypto.ts');
    expect(result.errors).toEqual([]);

    // The security directory should be cleaned up since it's now empty
    expect(existsSync(join(testDir, 'internal/security'))).toBe(false);
    // The public directory should still exist
    expect(existsSync(join(testDir, 'internal/public'))).toBe(true);
  });

  it('should not remove files that do not match any pattern', () => {
    createFile('src/index.ts', 'content');
    createFile('src/utils.ts', 'content');
    createFile('package.json', 'content');

    const result = removeExcludedFiles(testDir, ['*.secret', 'private/**']);

    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(fileExists('src/index.ts')).toBe(true);
    expect(fileExists('src/utils.ts')).toBe(true);
    expect(fileExists('package.json')).toBe(true);
  });

  it('should handle patterns with no matching files', () => {
    createFile('src/index.ts', 'content');

    const result = removeExcludedFiles(testDir, ['nonexistent/**', '*.xyz']);

    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(fileExists('src/index.ts')).toBe(true);
  });

  it('should handle undefined patterns gracefully', () => {
    createFile('file.ts', 'content');

    // @ts-expect-error - Testing runtime behavior with undefined
    const result = removeExcludedFiles(testDir, undefined);

    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(fileExists('file.ts')).toBe(true);
  });

  it('should handle complex real-world patterns', () => {
    // Create a realistic project structure
    createFile('src/index.ts', 'content');
    createFile('src/auth/login.ts', 'content');
    createFile('src/auth/login.security.ts', 'security code');
    createFile('scripts/deploy.ts', 'content');
    createFile('scripts/security-check.ts', 'security script');
    createFile('internal/secrets/api-keys.ts', 'api keys');
    createFile('internal/config.ts', 'content');
    createFile('.env', 'env vars');
    createFile('.env.production', 'prod env');

    const result = removeExcludedFiles(testDir, [
      'scripts/security-check.ts',
      '**/*.security.ts',
      'internal/secrets/**',
    ]);

    // These should be removed
    expect(result.removed).toContain('scripts/security-check.ts');
    expect(result.removed).toContain('src/auth/login.security.ts');
    expect(result.removed).toContain('internal/secrets/api-keys.ts');

    // These should remain
    expect(result.removed).not.toContain('src/index.ts');
    expect(result.removed).not.toContain('src/auth/login.ts');
    expect(result.removed).not.toContain('scripts/deploy.ts');
    expect(result.removed).not.toContain('internal/config.ts');
    expect(result.removed).not.toContain('.env');
    expect(result.removed).not.toContain('.env.production');

    expect(result.errors).toEqual([]);

    // Verify file system state
    expect(fileExists('scripts/security-check.ts')).toBe(false);
    expect(fileExists('src/auth/login.security.ts')).toBe(false);
    expect(fileExists('internal/secrets/api-keys.ts')).toBe(false);
    expect(fileExists('src/index.ts')).toBe(true);
    expect(fileExists('src/auth/login.ts')).toBe(true);
    expect(fileExists('scripts/deploy.ts')).toBe(true);
    expect(fileExists('internal/config.ts')).toBe(true);
  });
});
