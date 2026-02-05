import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectConfigManager } from 'rover-core';

vi.mock('../sandbox/container-common.js', () => ({
  getDefaultAgentImage: vi.fn(() => 'ghcr.io/endorhq/rover/agent:v1.0.0'),
}));

import {
  checkImageStatus,
  computePackagesHash,
  formatImageStatus,
} from '../image-status.js';

describe('image-status', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'image-status-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function createProjectConfig(config: {
    languages?: string[];
    packageManagers?: string[];
    taskManagers?: string[];
    sandbox?: {
      agentImage?: string;
      generatedFrom?: {
        baseImage: string;
        roverVersion: string;
        packagesHash: string;
        generatedAt: string;
      };
    };
  }): ProjectConfigManager {
    const roverJson = {
      version: '1.3',
      languages: config.languages || [],
      mcps: [],
      packageManagers: config.packageManagers || [],
      taskManagers: config.taskManagers || [],
      attribution: true,
      sandbox: config.sandbox,
    };
    writeFileSync(join(testDir, 'rover.json'), JSON.stringify(roverJson));
    return ProjectConfigManager.load(testDir);
  }

  describe('computePackagesHash', () => {
    it('returns consistent hash for same packages', () => {
      const config1 = createProjectConfig({
        languages: ['javascript', 'python'],
      });
      const hash1 = computePackagesHash(config1);

      // Recreate with same config
      const config2 = createProjectConfig({
        languages: ['javascript', 'python'],
      });
      const hash2 = computePackagesHash(config2);

      expect(hash1).toBe(hash2);
    });

    it('returns different hash for different packages', () => {
      const config1 = createProjectConfig({
        languages: ['javascript'],
      });
      const hash1 = computePackagesHash(config1);

      const config2 = createProjectConfig({
        languages: ['python'],
      });
      const hash2 = computePackagesHash(config2);

      expect(hash1).not.toBe(hash2);
    });

    it('returns same hash regardless of package order', () => {
      const config1 = createProjectConfig({
        languages: ['javascript', 'python', 'go'],
      });
      const hash1 = computePackagesHash(config1);

      const config2 = createProjectConfig({
        languages: ['go', 'javascript', 'python'],
      });
      const hash2 = computePackagesHash(config2);

      expect(hash1).toBe(hash2);
    });

    it('returns 8 character hex hash', () => {
      const config = createProjectConfig({
        languages: ['javascript'],
      });
      const hash = computePackagesHash(config);

      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('includes all package types in hash', () => {
      const config1 = createProjectConfig({
        languages: ['javascript'],
        packageManagers: [],
        taskManagers: [],
      });
      const hash1 = computePackagesHash(config1);

      const config2 = createProjectConfig({
        languages: ['javascript'],
        packageManagers: ['pnpm'],
        taskManagers: [],
      });
      const hash2 = computePackagesHash(config2);

      const config3 = createProjectConfig({
        languages: ['javascript'],
        packageManagers: ['pnpm'],
        taskManagers: ['make'],
      });
      const hash3 = computePackagesHash(config3);

      expect(hash1).not.toBe(hash2);
      expect(hash2).not.toBe(hash3);
    });
  });

  describe('checkImageStatus', () => {
    it('returns status "none" when no custom image configured', () => {
      const config = createProjectConfig({
        languages: ['javascript'],
      });
      const status = checkImageStatus(config);

      expect(status.status).toBe('none');
      expect(status.issues).toBeUndefined();
    });

    it('returns status "none" when agentImage but no generatedFrom', () => {
      const config = createProjectConfig({
        languages: ['javascript'],
        sandbox: {
          agentImage: 'my-image:latest',
        },
      });
      const status = checkImageStatus(config);

      expect(status.status).toBe('none');
    });

    it('returns status "up-to-date" when everything matches', () => {
      const config = createProjectConfig({
        languages: ['javascript'],
        sandbox: {
          agentImage: 'my-image:latest',
          generatedFrom: {
            baseImage: 'ghcr.io/endorhq/rover/agent:v1.0.0',
            roverVersion: '1.0.0',
            packagesHash: computePackagesHash(
              createProjectConfig({ languages: ['javascript'] })
            ),
            generatedAt: new Date().toISOString(),
          },
        },
      });

      // Need to reload to get the correct hash
      const reloadedConfig = ProjectConfigManager.load(testDir);
      const status = checkImageStatus(reloadedConfig);

      expect(status.status).toBe('up-to-date');
      expect(status.issues).toBeUndefined();
    });

    it('returns status "outdated" when base image differs', () => {
      const config = createProjectConfig({
        languages: ['javascript'],
        sandbox: {
          agentImage: 'my-image:latest',
          generatedFrom: {
            baseImage: 'ghcr.io/endorhq/rover/agent:v0.9.0', // old version
            roverVersion: '0.9.0',
            packagesHash: computePackagesHash(
              createProjectConfig({ languages: ['javascript'] })
            ),
            generatedAt: new Date().toISOString(),
          },
        },
      });

      const reloadedConfig = ProjectConfigManager.load(testDir);
      const status = checkImageStatus(reloadedConfig);

      expect(status.status).toBe('outdated');
      expect(status.issues).toBeDefined();
      expect(status.issues).toContain(
        'Base image update available: ghcr.io/endorhq/rover/agent:v1.0.0'
      );
    });

    it('returns status "outdated" when packages hash differs', () => {
      const config = createProjectConfig({
        languages: ['javascript', 'python'], // different from hash
        sandbox: {
          agentImage: 'my-image:latest',
          generatedFrom: {
            baseImage: 'ghcr.io/endorhq/rover/agent:v1.0.0',
            roverVersion: '1.0.0',
            packagesHash: 'oldhash1', // doesn't match
            generatedAt: new Date().toISOString(),
          },
        },
      });

      const reloadedConfig = ProjectConfigManager.load(testDir);
      const status = checkImageStatus(reloadedConfig);

      expect(status.status).toBe('outdated');
      expect(status.issues).toBeDefined();
      expect(status.issues).toContain(
        'Project configuration changed (detected packages differ)'
      );
    });

    it('returns multiple issues when both base image and packages differ', () => {
      const config = createProjectConfig({
        languages: ['javascript'],
        sandbox: {
          agentImage: 'my-image:latest',
          generatedFrom: {
            baseImage: 'ghcr.io/endorhq/rover/agent:v0.9.0',
            roverVersion: '0.9.0',
            packagesHash: 'oldhash1',
            generatedAt: new Date().toISOString(),
          },
        },
      });

      const reloadedConfig = ProjectConfigManager.load(testDir);
      const status = checkImageStatus(reloadedConfig);

      expect(status.status).toBe('outdated');
      expect(status.issues).toHaveLength(2);
    });

    it('includes metadata in status response', () => {
      const generatedAt = '2025-01-15T10:00:00Z';
      const config = createProjectConfig({
        languages: ['javascript'],
        sandbox: {
          agentImage: 'my-image:latest',
          generatedFrom: {
            baseImage: 'ghcr.io/endorhq/rover/agent:v0.9.0',
            roverVersion: '0.9.0',
            packagesHash: 'oldhash1',
            generatedAt,
          },
        },
      });

      const reloadedConfig = ProjectConfigManager.load(testDir);
      const status = checkImageStatus(reloadedConfig);

      expect(status.generatedBaseImage).toBe(
        'ghcr.io/endorhq/rover/agent:v0.9.0'
      );
      expect(status.currentBaseImage).toBe(
        'ghcr.io/endorhq/rover/agent:v1.0.0'
      );
      expect(status.generatedAt).toBe(generatedAt);
      expect(status.currentPackagesHash).toBeDefined();
      expect(status.generatedPackagesHash).toBe('oldhash1');
    });
  });

  describe('formatImageStatus', () => {
    it('formats "none" status correctly', () => {
      const output = formatImageStatus({ status: 'none' });

      expect(output).toContain('No custom image configured');
      expect(output).toContain('rover image build');
    });

    it('formats "up-to-date" status correctly', () => {
      const output = formatImageStatus({
        status: 'up-to-date',
        generatedBaseImage: 'ghcr.io/endorhq/rover/agent:v1.0.0',
        generatedAt: new Date().toISOString(),
      });

      expect(output).toContain('Status: Up to date');
      expect(output).toContain('ghcr.io/endorhq/rover/agent:v1.0.0');
    });

    it('formats "outdated" status with issues', () => {
      const output = formatImageStatus({
        status: 'outdated',
        issues: ['Base image update available', 'Project config changed'],
        generatedBaseImage: 'ghcr.io/endorhq/rover/agent:v0.9.0',
        generatedAt: '2025-01-01T10:00:00Z',
      });

      expect(output).toContain('Status: Outdated');
      expect(output).toContain('Base image update available');
      expect(output).toContain('Project config changed');
      expect(output).toContain('rover image rebuild');
    });

    it('formats relative time correctly for today', () => {
      const output = formatImageStatus({
        status: 'up-to-date',
        generatedBaseImage: 'test',
        generatedAt: new Date().toISOString(),
      });

      expect(output).toContain('today');
    });

    it('formats relative time correctly for yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const output = formatImageStatus({
        status: 'up-to-date',
        generatedBaseImage: 'test',
        generatedAt: yesterday.toISOString(),
      });

      expect(output).toContain('yesterday');
    });

    it('formats relative time correctly for weeks ago', () => {
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      const output = formatImageStatus({
        status: 'up-to-date',
        generatedBaseImage: 'test',
        generatedAt: twoWeeksAgo.toISOString(),
      });

      expect(output).toContain('2 weeks ago');
    });
  });
});
