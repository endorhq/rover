import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock rover-core
vi.mock('rover-core', async () => {
  const actual = await vi.importActual('rover-core');
  return {
    ...actual,
    getVersion: vi.fn(() => '1.0.0'),
    launch: vi.fn(() =>
      Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
    ),
  };
});

// Mock context
vi.mock('../../../lib/context.js', () => ({
  getProjectPath: vi.fn(),
}));

// Mock container-common
vi.mock('../../../lib/sandbox/container-common.js', () => ({
  getDefaultAgentImage: vi.fn(() => 'ghcr.io/endorhq/rover/agent:v1.0.0'),
}));

// Mock exit utilities
vi.mock('../../../utils/exit.js', () => ({
  exitWithError: vi.fn(result => {
    throw new Error(result.error);
  }),
  exitWithSuccess: vi.fn(),
}));

import { getProjectPath } from '../../../lib/context.js';
import { launch, ProjectConfigManager } from 'rover-core';
import { exitWithError, exitWithSuccess } from '../../../utils/exit.js';

describe('rover image build', () => {
  let testDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testDir = mkdtempSync(join(tmpdir(), 'image-build-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function createProjectConfig(
    config: Partial<{
      languages: string[];
      packageManagers: string[];
      taskManagers: string[];
    }> = {}
  ): void {
    const roverJson = {
      version: '1.3',
      languages: config.languages || [],
      mcps: [],
      packageManagers: config.packageManagers || [],
      taskManagers: config.taskManagers || [],
      attribution: true,
    };
    writeFileSync(join(testDir, 'rover.json'), JSON.stringify(roverJson));
  }

  describe('build command behavior', () => {
    it('sets skipPackageInstall to true after successful build', async () => {
      createProjectConfig({ languages: ['javascript'] });
      vi.mocked(getProjectPath).mockReturnValue(testDir);

      // Import the command module to test the action
      const buildModule = await import('../build.js');
      const buildCmd = buildModule.default;

      // Execute the action with build enabled
      await buildCmd.action({ build: true, force: true });

      // Verify skipPackageInstall was set
      const roverJson = JSON.parse(
        readFileSync(join(testDir, 'rover.json'), 'utf8')
      );
      expect(roverJson.sandbox?.skipPackageInstall).toBe(true);
    });

    it('does not set skipPackageInstall when --no-build is used', async () => {
      createProjectConfig({ languages: ['javascript'] });
      vi.mocked(getProjectPath).mockReturnValue(testDir);

      const buildModule = await import('../build.js');
      const buildCmd = buildModule.default;

      // Execute the action with build disabled
      await buildCmd.action({ build: false, force: true });

      // Verify skipPackageInstall was NOT set
      const roverJson = JSON.parse(
        readFileSync(join(testDir, 'rover.json'), 'utf8')
      );
      expect(roverJson.sandbox?.skipPackageInstall).toBeUndefined();
    });

    it('generates Dockerfile.rover in project directory', async () => {
      createProjectConfig({ languages: ['python'] });
      vi.mocked(getProjectPath).mockReturnValue(testDir);

      const buildModule = await import('../build.js');
      const buildCmd = buildModule.default;

      await buildCmd.action({ build: false, force: true });

      // Verify Dockerfile.rover was created
      const dockerfile = readFileSync(
        join(testDir, 'Dockerfile.rover'),
        'utf8'
      );
      expect(dockerfile).toContain('FROM ${BASE_IMAGE}');
      expect(dockerfile).toContain('python');
    });

    it('calls docker build with correct arguments', async () => {
      createProjectConfig({ languages: ['javascript'] });
      vi.mocked(getProjectPath).mockReturnValue(testDir);

      const buildModule = await import('../build.js');
      const buildCmd = buildModule.default;

      await buildCmd.action({ build: true, force: true });

      // Verify launch was called with docker build
      expect(launch).toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining(['build', '-f', 'Dockerfile.rover']),
        expect.any(Object)
      );
    });

    it('stores generatedFrom metadata after build', async () => {
      createProjectConfig({ languages: ['javascript'] });
      vi.mocked(getProjectPath).mockReturnValue(testDir);

      const buildModule = await import('../build.js');
      const buildCmd = buildModule.default;

      await buildCmd.action({ build: true, force: true });

      const roverJson = JSON.parse(
        readFileSync(join(testDir, 'rover.json'), 'utf8')
      );
      expect(roverJson.sandbox?.generatedFrom).toBeDefined();
      expect(roverJson.sandbox?.generatedFrom?.baseImage).toBe(
        'ghcr.io/endorhq/rover/agent:v1.0.0'
      );
      expect(roverJson.sandbox?.generatedFrom?.roverVersion).toBe('1.0.0');
      expect(roverJson.sandbox?.generatedFrom?.packagesHash).toBeDefined();
      expect(roverJson.sandbox?.generatedFrom?.generatedAt).toBeDefined();
    });

    it('uses custom tag when provided', async () => {
      createProjectConfig({});
      vi.mocked(getProjectPath).mockReturnValue(testDir);

      const buildModule = await import('../build.js');
      const buildCmd = buildModule.default;

      await buildCmd.action({
        build: true,
        force: true,
        tag: 'my-custom-image:v2.0.0',
      });

      // Verify launch was called with custom tag
      expect(launch).toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining(['-t', 'my-custom-image:v2.0.0']),
        expect.any(Object)
      );

      const roverJson = JSON.parse(
        readFileSync(join(testDir, 'rover.json'), 'utf8')
      );
      expect(roverJson.sandbox?.agentImage).toBe('my-custom-image:v2.0.0');
    });

    it('errors when Dockerfile.rover exists without --force', async () => {
      createProjectConfig({});
      writeFileSync(join(testDir, 'Dockerfile.rover'), '# existing');
      vi.mocked(getProjectPath).mockReturnValue(testDir);

      const buildModule = await import('../build.js');
      const buildCmd = buildModule.default;

      await expect(buildCmd.action({ build: true })).rejects.toThrow(
        'already exists'
      );
    });

    it('errors when no project context found', async () => {
      vi.mocked(getProjectPath).mockReturnValue(undefined as any);

      const buildModule = await import('../build.js');
      const buildCmd = buildModule.default;

      await expect(buildCmd.action({ build: true })).rejects.toThrow(
        'No project context found'
      );
    });
  });
});
