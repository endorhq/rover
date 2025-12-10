import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { findProjectRoot, clearProjectRootCache } from '../os.js';
import { Git } from '../git.js';

// Create a mock function that will be used by all Git instances
const mockGetRepositoryRoot = vi.fn();

// Mock the Git class
vi.mock('../git.js', () => {
  return {
    Git: vi.fn().mockImplementation(() => {
      return {
        getRepositoryRoot: mockGetRepositoryRoot,
      };
    }),
  };
});

describe('os', () => {
  let originalCwd: string;

  beforeEach(() => {
    // Clear cache before each test
    clearProjectRootCache();

    // Store original cwd
    originalCwd = process.cwd();

    // Reset the mock function
    mockGetRepositoryRoot.mockReset();
  });

  afterEach(() => {
    // Clear cache after each test
    clearProjectRootCache();
  });

  describe('findProjectRoot', () => {
    it('should call git.getRepositoryRoot() on first invocation', () => {
      mockGetRepositoryRoot.mockReturnValue('/path/to/repo');

      const result = findProjectRoot();

      expect(mockGetRepositoryRoot).toHaveBeenCalledTimes(1);
      expect(result).toBe('/path/to/repo');
    });

    it('should return cached value on subsequent calls without calling Git', () => {
      mockGetRepositoryRoot.mockReturnValue('/path/to/repo');

      // First call
      const result1 = findProjectRoot();
      expect(mockGetRepositoryRoot).toHaveBeenCalledTimes(1);
      expect(result1).toBe('/path/to/repo');

      // Second call should use cache
      const result2 = findProjectRoot();
      expect(mockGetRepositoryRoot).toHaveBeenCalledTimes(1); // Still 1, not 2
      expect(result2).toBe('/path/to/repo');

      // Third call should also use cache
      const result3 = findProjectRoot();
      expect(mockGetRepositoryRoot).toHaveBeenCalledTimes(1); // Still 1
      expect(result3).toBe('/path/to/repo');
    });

    it('should fall back to process.cwd() when not in a Git repository', () => {
      mockGetRepositoryRoot.mockReturnValue(null);

      const result = findProjectRoot();

      expect(mockGetRepositoryRoot).toHaveBeenCalledTimes(1);
      expect(result).toBe(originalCwd);
    });

    it('should cache the fallback process.cwd() value', () => {
      mockGetRepositoryRoot.mockReturnValue(null);

      // First call
      const result1 = findProjectRoot();
      expect(result1).toBe(originalCwd);
      expect(mockGetRepositoryRoot).toHaveBeenCalledTimes(1);

      // Second call should use cached fallback value
      const result2 = findProjectRoot();
      expect(result2).toBe(originalCwd);
      expect(mockGetRepositoryRoot).toHaveBeenCalledTimes(1); // Still 1
    });
  });

  describe('clearProjectRootCache', () => {
    it('should invalidate the cache', () => {
      mockGetRepositoryRoot.mockReturnValue('/path/to/repo');

      // First call - caches the value
      findProjectRoot();
      expect(mockGetRepositoryRoot).toHaveBeenCalledTimes(1);

      // Clear cache
      clearProjectRootCache();

      // Next call should trigger Git subprocess again
      mockGetRepositoryRoot.mockReturnValue('/different/path');
      const result = findProjectRoot();

      expect(mockGetRepositoryRoot).toHaveBeenCalledTimes(2);
      expect(result).toBe('/different/path');
    });

    it('should allow cache to be re-populated after clearing', () => {
      mockGetRepositoryRoot.mockReturnValue('/first/path');

      // First call
      const result1 = findProjectRoot();
      expect(result1).toBe('/first/path');

      // Clear and call again with different mock value
      clearProjectRootCache();
      mockGetRepositoryRoot.mockReturnValue('/second/path');
      const result2 = findProjectRoot();
      expect(result2).toBe('/second/path');

      // Subsequent call should use new cached value
      const result3 = findProjectRoot();
      expect(result3).toBe('/second/path');
      expect(mockGetRepositoryRoot).toHaveBeenCalledTimes(2); // Only called twice total
    });

    it('should be safe to call multiple times', () => {
      clearProjectRootCache();
      clearProjectRootCache();
      clearProjectRootCache();

      // Should not throw and should work normally
      mockGetRepositoryRoot.mockReturnValue('/path/to/repo');
      const result = findProjectRoot();
      expect(result).toBe('/path/to/repo');
    });
  });
});
