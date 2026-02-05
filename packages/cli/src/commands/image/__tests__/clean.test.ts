import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock rover-core
vi.mock('rover-core', async () => {
  const actual = await vi.importActual('rover-core');
  return {
    ...actual,
    launch: vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })),
  };
});

// Mock context
vi.mock('../../../lib/context.js', () => ({
  getProjectPath: vi.fn(),
  isJsonMode: vi.fn(() => false),
  setJsonMode: vi.fn(),
}));

// Mock exit utilities
vi.mock('../../../utils/exit.js', () => ({
  exitWithError: vi.fn((result) => {
    throw new Error(result.error);
  }),
  exitWithSuccess: vi.fn(),
}));

// Mock enquirer to avoid interactive prompts
vi.mock('enquirer', () => ({
  default: {
    prompt: vi.fn(() => Promise.resolve({ confirm: true })),
  },
}));

import { getProjectPath } from '../../../lib/context.js';
import { launch } from 'rover-core';
import { exitWithSuccess } from '../../../utils/exit.js';

describe('rover image clean', () => {
  let testDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testDir = mkdtempSync(join(tmpdir(), 'image-clean-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function createProjectConfig(
    config: Partial<{
      agentImage: string;
      generatedFrom: object;
      skipPackageInstall: boolean;
    }> = {}
  ): void {
    const roverJson: any = {
      version: '1.3',
      languages: [],
      mcps: [],
      packageManagers: [],
      taskManagers: [],
      attribution: true,
    };

    if (
      config.agentImage ||
      config.generatedFrom ||
      config.skipPackageInstall
    ) {
      roverJson.sandbox = {};
      if (config.agentImage) {
        roverJson.sandbox.agentImage = config.agentImage;
      }
      if (config.generatedFrom) {
        roverJson.sandbox.generatedFrom = config.generatedFrom;
      }
      if (config.skipPackageInstall) {
        roverJson.sandbox.skipPackageInstall = config.skipPackageInstall;
      }
    }

    writeFileSync(join(testDir, 'rover.json'), JSON.stringify(roverJson));
  }

  describe('clean command behavior', () => {
    it('removes Dockerfile.rover when it exists', async () => {
      createProjectConfig({ agentImage: 'test:latest' });
      writeFileSync(join(testDir, 'Dockerfile.rover'), '# test');
      vi.mocked(getProjectPath).mockReturnValue(testDir);

      const cleanModule = await import('../clean.js');
      const cleanCmd = cleanModule.default;

      await cleanCmd.action({ yes: true });

      expect(existsSync(join(testDir, 'Dockerfile.rover'))).toBe(false);
    });

    it('resets skipPackageInstall when --reset-config is used', async () => {
      createProjectConfig({
        agentImage: 'test:latest',
        generatedFrom: {
          baseImage: 'ghcr.io/endorhq/rover/agent:v1.0.0',
          roverVersion: '1.0.0',
          packagesHash: 'abc123',
          generatedAt: '2026-01-01T00:00:00Z',
        },
        skipPackageInstall: true,
      });
      vi.mocked(getProjectPath).mockReturnValue(testDir);

      const cleanModule = await import('../clean.js');
      const cleanCmd = cleanModule.default;

      await cleanCmd.action({ yes: true, resetConfig: true });

      const roverJson = JSON.parse(
        readFileSync(join(testDir, 'rover.json'), 'utf8')
      );
      expect(roverJson.sandbox?.skipPackageInstall).toBe(false);
      expect(roverJson.sandbox?.agentImage).toBeUndefined();
      expect(roverJson.sandbox?.generatedFrom).toBeUndefined();
    });

    it('calls docker rmi when --remove-image is used', async () => {
      createProjectConfig({ agentImage: 'my-image:latest' });
      writeFileSync(join(testDir, 'Dockerfile.rover'), '# test');
      vi.mocked(getProjectPath).mockReturnValue(testDir);

      const cleanModule = await import('../clean.js');
      const cleanCmd = cleanModule.default;

      await cleanCmd.action({ yes: true, removeImage: true });

      expect(launch).toHaveBeenCalledWith(
        'docker',
        ['rmi', 'my-image:latest'],
        expect.any(Object)
      );
    });

    it('errors when no custom image configuration found', async () => {
      createProjectConfig({});
      vi.mocked(getProjectPath).mockReturnValue(testDir);

      const cleanModule = await import('../clean.js');
      const cleanCmd = cleanModule.default;

      await expect(cleanCmd.action({ yes: true })).rejects.toThrow(
        'No custom image configuration found'
      );
    });

    it('detects skipPackageInstall as something to clean', async () => {
      // Only skipPackageInstall is set, no agentImage or generatedFrom
      createProjectConfig({ skipPackageInstall: true });
      vi.mocked(getProjectPath).mockReturnValue(testDir);

      const cleanModule = await import('../clean.js');
      const cleanCmd = cleanModule.default;

      // Should not error - skipPackageInstall alone is cleanable
      await cleanCmd.action({ yes: true, resetConfig: true });

      const roverJson = JSON.parse(
        readFileSync(join(testDir, 'rover.json'), 'utf8')
      );
      expect(roverJson.sandbox?.skipPackageInstall).toBe(false);
    });
  });
});
