import { describe, it, expect } from 'vitest';
import { join, resolve } from 'node:path';
import { isPathWithin } from '../path-utils.js';

describe('isPathWithin', () => {
  const testDir = '/home/user/project';

  describe('valid child paths', () => {
    it('should return true for a direct child file', () => {
      expect(isPathWithin(`${testDir}/file.txt`, testDir)).toBe(true);
    });

    it('should return true for a nested child file', () => {
      expect(isPathWithin(`${testDir}/src/components/file.txt`, testDir)).toBe(
        true
      );
    });

    it('should return true for a child directory', () => {
      expect(isPathWithin(`${testDir}/src`, testDir)).toBe(true);
    });

    it('should return true for deeply nested paths', () => {
      expect(isPathWithin(`${testDir}/a/b/c/d/e/f.txt`, testDir)).toBe(true);
    });
  });

  describe('paths outside parent', () => {
    it('should return false for sibling directory', () => {
      expect(isPathWithin('/home/user/other/file.txt', testDir)).toBe(false);
    });

    it('should return false for parent directory', () => {
      expect(isPathWithin('/home/user', testDir)).toBe(false);
    });

    it('should return false for completely unrelated path', () => {
      expect(isPathWithin('/var/log/file.txt', testDir)).toBe(false);
    });

    it('should return false for root path', () => {
      expect(isPathWithin('/', testDir)).toBe(false);
    });
  });

  describe('path traversal attempts', () => {
    it('should return false for path with .. that escapes parent', () => {
      expect(isPathWithin(`${testDir}/../other/file.txt`, testDir)).toBe(false);
    });

    it('should return false for path with multiple .. that escapes parent', () => {
      expect(isPathWithin(`${testDir}/src/../../other/file.txt`, testDir)).toBe(
        false
      );
    });

    it('should return true for path with .. that stays within parent', () => {
      expect(isPathWithin(`${testDir}/src/../lib/file.txt`, testDir)).toBe(
        true
      );
    });

    it('should return false for path trying to traverse above root', () => {
      expect(isPathWithin(`${testDir}/../../../../etc/passwd`, testDir)).toBe(
        false
      );
    });
  });

  describe('same path handling', () => {
    it('should return false when child and parent are the same path', () => {
      expect(isPathWithin(testDir, testDir)).toBe(false);
    });

    it('should return false when paths resolve to the same location', () => {
      expect(isPathWithin(`${testDir}/src/..`, testDir)).toBe(false);
    });
  });

  describe('relative path handling', () => {
    it('should handle relative child paths by resolving against cwd', () => {
      const cwd = process.cwd();
      const childPath = 'subdir/file.txt';
      const expectedResolved = resolve(childPath);

      // The result depends on whether the resolved path is within cwd
      const result = isPathWithin(childPath, cwd);
      expect(result).toBe(true);
    });

    it('should handle relative parent paths', () => {
      const cwd = process.cwd();
      // A file in cwd should be within '.'
      const childPath = join(cwd, 'file.txt');
      expect(isPathWithin(childPath, '.')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle paths with trailing slashes', () => {
      expect(isPathWithin(`${testDir}/file.txt`, `${testDir}/`)).toBe(true);
    });

    it('should handle paths with multiple consecutive slashes', () => {
      expect(isPathWithin(`${testDir}//src//file.txt`, testDir)).toBe(true);
    });

    it('should handle paths with . segments', () => {
      expect(isPathWithin(`${testDir}/./src/./file.txt`, testDir)).toBe(true);
    });

    it('should return false for prefix match that is not a parent', () => {
      // /home/user/project-other is NOT within /home/user/project
      // This is a key security case that startsWith() would fail
      expect(isPathWithin('/home/user/project-other/file.txt', testDir)).toBe(
        false
      );
    });

    it('should handle empty relative path components', () => {
      expect(isPathWithin(`${testDir}/src/`, testDir)).toBe(true);
    });
  });
});
