import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Store original values
const originalPlatform = process.platform;
const originalEnv = { ...process.env };

// Helper to mock platform
function mockPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', {
    value: platform,
    writable: true,
    configurable: true,
  });
}

// Helper to restore original platform
function restorePlatform() {
  Object.defineProperty(process, 'platform', {
    value: originalPlatform,
    writable: true,
    configurable: true,
  });
}

describe('paths', () => {
  beforeEach(() => {
    // Clear module cache to ensure fresh imports with new mocked values
    vi.resetModules();
    // Reset environment variables
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original values
    restorePlatform();
    process.env = { ...originalEnv };
  });

  describe('macOS platform (darwin)', () => {
    beforeEach(() => {
      mockPlatform('darwin');
    });

    it('should return ~/.rover/config for getConfigDir', async () => {
      const { getConfigDir } = await import('../paths.js');
      const result = getConfigDir();

      expect(result).toContain('.rover');
      expect(result).toContain('config');
      expect(result).toMatch(/\.rover\/config$/);
    });

    it('should return ~/.rover/data for getDataDir', async () => {
      const { getDataDir } = await import('../paths.js');
      const result = getDataDir();

      expect(result).toContain('.rover');
      expect(result).toContain('data');
      expect(result).toMatch(/\.rover\/data$/);
    });

    it('should return ~/.rover/cache for getCacheDir', async () => {
      const { getCacheDir } = await import('../paths.js');
      const result = getCacheDir();

      expect(result).toContain('.rover');
      expect(result).toContain('cache');
      expect(result).toMatch(/\.rover\/cache$/);
    });
  });

  describe('Linux platform', () => {
    beforeEach(() => {
      mockPlatform('linux');
    });

    it('should return ~/.rover/config for getConfigDir', async () => {
      const { getConfigDir } = await import('../paths.js');
      const result = getConfigDir();

      expect(result).toContain('.rover');
      expect(result).toContain('config');
      expect(result).toMatch(/\.rover\/config$/);
    });

    it('should return ~/.rover/data for getDataDir', async () => {
      const { getDataDir } = await import('../paths.js');
      const result = getDataDir();

      expect(result).toContain('.rover');
      expect(result).toContain('data');
      expect(result).toMatch(/\.rover\/data$/);
    });

    it('should return ~/.rover/cache for getCacheDir', async () => {
      const { getCacheDir } = await import('../paths.js');
      const result = getCacheDir();

      expect(result).toContain('.rover');
      expect(result).toContain('cache');
      expect(result).toMatch(/\.rover\/cache$/);
    });
  });

  describe('Windows platform (win32)', () => {
    beforeEach(() => {
      mockPlatform('win32');
      process.env.APPDATA = 'C:\\Users\\TestUser\\AppData\\Roaming';
      process.env.LOCALAPPDATA = 'C:\\Users\\TestUser\\AppData\\Local';
    });

    it('should return %APPDATA%/Rover/config for getConfigDir', async () => {
      const { getConfigDir } = await import('../paths.js');
      const result = getConfigDir();

      expect(result).toContain('Rover');
      expect(result).toContain('config');
      expect(result).toContain('AppData');
      expect(result).toMatch(/Rover[\\\/]config$/);
    });

    it('should return %APPDATA%/Rover/data for getDataDir', async () => {
      const { getDataDir } = await import('../paths.js');
      const result = getDataDir();

      expect(result).toContain('Rover');
      expect(result).toContain('data');
      expect(result).toContain('AppData');
      expect(result).toMatch(/Rover[\\\/]data$/);
    });

    it('should return %LOCALAPPDATA%/Rover/cache for getCacheDir', async () => {
      const { getCacheDir } = await import('../paths.js');
      const result = getCacheDir();

      expect(result).toContain('Rover');
      expect(result).toContain('cache');
      expect(result).toContain('Local');
      expect(result).toMatch(/Rover[\\\/]cache$/);
    });

    it('should throw error when APPDATA is not set', async () => {
      delete process.env.APPDATA;
      const { getConfigDir } = await import('../paths.js');

      expect(() => getConfigDir()).toThrow(
        'APPDATA environment variable not found on Windows'
      );
    });

    it('should throw error when LOCALAPPDATA is not set for cache', async () => {
      delete process.env.LOCALAPPDATA;
      const { getCacheDir } = await import('../paths.js');

      expect(() => getCacheDir()).toThrow(
        'LOCALAPPDATA environment variable not found on Windows'
      );
    });
  });

  describe('ensureDirectories', () => {
    let testBaseDir: string;

    beforeEach(() => {
      // Create a unique test directory in system temp
      testBaseDir = join(
        tmpdir(),
        `rover-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
    });

    afterEach(() => {
      // Clean up test directory
      if (existsSync(testBaseDir)) {
        rmSync(testBaseDir, { recursive: true, force: true });
      }
    });

    it('should create all directories when they do not exist (Unix-like)', async () => {
      mockPlatform('linux');

      // Mock homedir to return our test directory
      vi.doMock('node:os', () => ({
        homedir: () => testBaseDir,
        tmpdir,
      }));

      const { ensureDirectories, getConfigDir, getDataDir, getCacheDir } =
        await import('../paths.js');

      // Verify directories don't exist yet
      const configDir = getConfigDir();
      const dataDir = getDataDir();
      const cacheDir = getCacheDir();

      expect(existsSync(configDir)).toBe(false);
      expect(existsSync(dataDir)).toBe(false);
      expect(existsSync(cacheDir)).toBe(false);

      // Create directories
      ensureDirectories();

      // Verify directories were created
      expect(existsSync(configDir)).toBe(true);
      expect(existsSync(dataDir)).toBe(true);
      expect(existsSync(cacheDir)).toBe(true);

      vi.doUnmock('node:os');
    });

    it('should not throw error when directories already exist', async () => {
      mockPlatform('linux');

      vi.doMock('node:os', () => ({
        homedir: () => testBaseDir,
        tmpdir,
      }));

      const { ensureDirectories, getConfigDir, getDataDir, getCacheDir } =
        await import('../paths.js');

      // Create directories manually first
      const configDir = getConfigDir();
      const dataDir = getDataDir();
      const cacheDir = getCacheDir();

      mkdirSync(configDir, { recursive: true });
      mkdirSync(dataDir, { recursive: true });
      mkdirSync(cacheDir, { recursive: true });

      // Should not throw
      expect(() => ensureDirectories()).not.toThrow();

      // Directories should still exist
      expect(existsSync(configDir)).toBe(true);
      expect(existsSync(dataDir)).toBe(true);
      expect(existsSync(cacheDir)).toBe(true);

      vi.doUnmock('node:os');
    });

    it('should be idempotent - safe to call multiple times', async () => {
      mockPlatform('darwin');

      vi.doMock('node:os', () => ({
        homedir: () => testBaseDir,
        tmpdir,
      }));

      const { ensureDirectories, getConfigDir, getDataDir, getCacheDir } =
        await import('../paths.js');

      // Call multiple times
      ensureDirectories();
      ensureDirectories();
      ensureDirectories();

      // Verify directories exist
      expect(existsSync(getConfigDir())).toBe(true);
      expect(existsSync(getDataDir())).toBe(true);
      expect(existsSync(getCacheDir())).toBe(true);

      vi.doUnmock('node:os');
    });
  });

  describe('path consistency', () => {
    it('should use the same base directory for config and data', async () => {
      mockPlatform('linux');

      const { getConfigDir, getDataDir } = await import('../paths.js');

      const configDir = getConfigDir();
      const dataDir = getDataDir();

      // Extract base directory (everything before /config or /data)
      const configBase = configDir.substring(0, configDir.lastIndexOf('/'));
      const dataBase = dataDir.substring(0, dataDir.lastIndexOf('/'));

      expect(configBase).toBe(dataBase);
    });

    it('should have different subdirectories for config, data, and cache', async () => {
      mockPlatform('darwin');

      const { getConfigDir, getDataDir, getCacheDir } = await import(
        '../paths.js'
      );

      const configDir = getConfigDir();
      const dataDir = getDataDir();
      const cacheDir = getCacheDir();

      // All should be different
      expect(configDir).not.toBe(dataDir);
      expect(configDir).not.toBe(cacheDir);
      expect(dataDir).not.toBe(cacheDir);
    });
  });
});
