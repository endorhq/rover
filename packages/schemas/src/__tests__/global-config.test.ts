import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Store mock config directory path
let mockConfigDir: string;

// Mock rover-core before imports
vi.mock('rover-core', () => ({
  getConfigDir: () => mockConfigDir,
  AI_AGENT: {
    Claude: 'claude',
    Codex: 'codex',
    Cursor: 'cursor',
    Gemini: 'gemini',
    Qwen: 'qwen',
  },
}));

// Mock rover-telemetry to avoid side effects
vi.mock('rover-telemetry', () => ({
  default: {
    load: () => ({
      getUserId: () => 'mock-user-id-12345',
      isDisabled: () => false,
    }),
  },
  TELEMETRY_FROM: {
    CLI: 'cli',
    EXTENSION: 'extension',
  },
}));

// Import after mocks are set up
import { GlobalConfigManager } from '../global-config.js';
import {
  GlobalConfigLoadError,
  GlobalConfigValidationError,
} from '../global-config/errors.js';
import {
  CURRENT_GLOBAL_CONFIG_VERSION,
  GLOBAL_CONFIG_FILENAME,
} from '../global-config/schema.js';
import { AI_AGENT } from 'rover-core';
import type {
  Language,
  PackageManager,
  TaskManager,
} from '../project-config/types.js';

describe('GlobalConfigManager', () => {
  let testDir: string;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'rover-global-config-test-'));
    mockConfigDir = testDir;
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('createDefault', () => {
    it('should create default config when file does not exist', () => {
      const config = GlobalConfigManager.createDefault();

      const filePath = join(testDir, GLOBAL_CONFIG_FILENAME);
      expect(existsSync(filePath)).toBe(true);

      const jsonData = JSON.parse(readFileSync(filePath, 'utf8'));

      // Version should be current
      expect(jsonData.version).toBe(CURRENT_GLOBAL_CONFIG_VERSION);

      // Should have default values
      expect(jsonData.agents).toEqual([]);
      expect(jsonData.userId).toBe('mock-user-id-12345');
      expect(jsonData.telemetry).toBe('enabled');
      expect(jsonData.attribution).toBe('unknown');
      expect(jsonData.projects).toEqual([]);

      // Timestamps should be valid ISO strings
      expect(new Date(jsonData.createdAt).toISOString()).toBe(
        jsonData.createdAt
      );
      expect(new Date(jsonData.updatedAt).toISOString()).toBe(
        jsonData.updatedAt
      );

      // Getters should return expected values
      expect(config.version).toBe(CURRENT_GLOBAL_CONFIG_VERSION);
      expect(config.agents).toEqual([]);
      expect(config.userId).toBe('mock-user-id-12345');
      expect(config.telemetry).toBe('enabled');
      expect(config.attribution).toBe('unknown');
      expect(config.projects).toEqual([]);
    });

    it('should create config directory if it does not exist', () => {
      // Remove the test directory to simulate missing config dir
      rmSync(testDir, { recursive: true, force: true });
      expect(existsSync(testDir)).toBe(false);

      GlobalConfigManager.createDefault();

      expect(existsSync(testDir)).toBe(true);
      expect(existsSync(join(testDir, GLOBAL_CONFIG_FILENAME))).toBe(true);
    });

    it('should set telemetry to disabled when telemetry is disabled', async () => {
      // Re-mock telemetry with disabled state
      vi.doMock('rover-telemetry', () => ({
        default: {
          load: () => ({
            getUserId: () => 'disabled-user-id',
            isDisabled: () => true,
          }),
        },
        TELEMETRY_FROM: {
          CLI: 'cli',
          EXTENSION: 'extension',
        },
      }));

      // Reset modules to pick up new mock
      vi.resetModules();

      const { GlobalConfigManager: FreshManager } = await import(
        '../global-config.js'
      );
      const config = FreshManager.createDefault();

      expect(config.telemetry).toBe('disabled');
      expect(config.userId).toBe('disabled-user-id');

      // Restore original mock
      vi.doUnmock('rover-telemetry');
      vi.resetModules();
    });
  });

  describe('load', () => {
    it('should create default config when file does not exist', () => {
      const config = GlobalConfigManager.load();

      expect(config.version).toBe(CURRENT_GLOBAL_CONFIG_VERSION);
      expect(config.agents).toEqual([]);
      expect(config.userId).toBe('mock-user-id-12345');
      expect(config.telemetry).toBe('enabled');
    });

    it('should load existing config file', () => {
      const now = new Date().toISOString();
      mkdirSync(testDir, { recursive: true });
      writeFileSync(
        join(testDir, GLOBAL_CONFIG_FILENAME),
        JSON.stringify(
          {
            version: CURRENT_GLOBAL_CONFIG_VERSION,
            agents: [AI_AGENT.Claude, AI_AGENT.Gemini],
            userId: 'existing-user-id',
            telemetry: 'disabled',
            attribution: 'enabled',
            createdAt: now,
            updatedAt: now,
            projects: [],
          },
          null,
          2
        )
      );

      const config = GlobalConfigManager.load();

      expect(config.version).toBe(CURRENT_GLOBAL_CONFIG_VERSION);
      expect(config.agents).toEqual([AI_AGENT.Claude, AI_AGENT.Gemini]);
      expect(config.userId).toBe('existing-user-id');
      expect(config.telemetry).toBe('disabled');
      expect(config.attribution).toBe('enabled');
    });

    it('should load config with projects', () => {
      const now = new Date().toISOString();
      const project = {
        id: 'project-123',
        path: '/path/to/project',
        repositoryName: 'my-repo',
        languages: ['typescript'],
        packageManagers: ['npm'],
        taskManagers: [],
      };

      mkdirSync(testDir, { recursive: true });
      writeFileSync(
        join(testDir, GLOBAL_CONFIG_FILENAME),
        JSON.stringify(
          {
            version: CURRENT_GLOBAL_CONFIG_VERSION,
            agents: [],
            userId: 'user-123',
            telemetry: 'enabled',
            attribution: 'unknown',
            createdAt: now,
            updatedAt: now,
            projects: [project],
          },
          null,
          2
        )
      );

      const config = GlobalConfigManager.load();

      expect(config.projects).toHaveLength(1);
      expect(config.projects[0]).toEqual(project);
    });

    it('should not re-save config when version is current', () => {
      const now = new Date().toISOString();
      const originalData = {
        version: CURRENT_GLOBAL_CONFIG_VERSION,
        agents: [AI_AGENT.Gemini],
        userId: 'original-user-id',
        telemetry: 'enabled',
        attribution: 'disabled',
        createdAt: now,
        updatedAt: now,
        projects: [],
      };

      mkdirSync(testDir, { recursive: true });
      writeFileSync(
        join(testDir, GLOBAL_CONFIG_FILENAME),
        JSON.stringify(originalData, null, 2)
      );

      const config = GlobalConfigManager.load();

      // Verify data is preserved
      expect(config.version).toBe(CURRENT_GLOBAL_CONFIG_VERSION);
      expect(config.agents).toEqual([AI_AGENT.Gemini]);
      expect(config.userId).toBe('original-user-id');

      // Check file wasn't modified (updatedAt would change if saved)
      const jsonData = JSON.parse(
        readFileSync(join(testDir, GLOBAL_CONFIG_FILENAME), 'utf8')
      );
      expect(jsonData.updatedAt).toBe(now);
    });
  });

  describe('exists', () => {
    it('should return false when config file does not exist', () => {
      expect(GlobalConfigManager.exists()).toBe(false);
    });

    it('should return true when config file exists', () => {
      const now = new Date().toISOString();
      mkdirSync(testDir, { recursive: true });
      writeFileSync(
        join(testDir, GLOBAL_CONFIG_FILENAME),
        JSON.stringify({
          version: CURRENT_GLOBAL_CONFIG_VERSION,
          agents: [],
          userId: 'test-user',
          telemetry: 'enabled',
          attribution: 'unknown',
          createdAt: now,
          updatedAt: now,
          projects: [],
        })
      );

      expect(GlobalConfigManager.exists()).toBe(true);
    });
  });

  describe('save', () => {
    it('should save config to disk', () => {
      const config = GlobalConfigManager.createDefault();
      const originalUpdatedAt = config.updatedAt;

      // Wait a bit to ensure timestamp difference
      const delay = (ms: number) =>
        new Promise(resolve => setTimeout(resolve, ms));

      return delay(10).then(() => {
        config.setAgents([AI_AGENT.Claude]);

        const jsonData = JSON.parse(
          readFileSync(join(testDir, GLOBAL_CONFIG_FILENAME), 'utf8')
        );
        expect(jsonData.agents).toEqual([AI_AGENT.Claude]);
        expect(jsonData.updatedAt).not.toBe(originalUpdatedAt);
      });
    });

    it('should create config directory if it does not exist', () => {
      // First create a config
      const config = GlobalConfigManager.createDefault();

      // Remove the directory
      rmSync(testDir, { recursive: true, force: true });
      expect(existsSync(testDir)).toBe(false);

      // Save should recreate the directory
      config.save();

      expect(existsSync(testDir)).toBe(true);
      expect(existsSync(join(testDir, GLOBAL_CONFIG_FILENAME))).toBe(true);
    });

    it('should update updatedAt timestamp on save', () => {
      const config = GlobalConfigManager.createDefault();
      const originalUpdatedAt = config.updatedAt;

      // Wait to ensure timestamp difference
      return new Promise<void>(resolve => {
        setTimeout(() => {
          config.save();
          expect(config.updatedAt).not.toBe(originalUpdatedAt);
          resolve();
        }, 10);
      });
    });
  });

  describe('reload', () => {
    it('should reload config from disk', () => {
      const config = GlobalConfigManager.createDefault();

      // Modify file on disk directly
      const now = new Date().toISOString();
      writeFileSync(
        join(testDir, GLOBAL_CONFIG_FILENAME),
        JSON.stringify(
          {
            version: CURRENT_GLOBAL_CONFIG_VERSION,
            agents: [AI_AGENT.Claude],
            userId: 'reloaded-user-id',
            telemetry: 'disabled',
            attribution: 'enabled',
            createdAt: now,
            updatedAt: now,
            projects: [],
          },
          null,
          2
        )
      );

      // Before reload, instance should have old data
      expect(config.agents).toEqual([]);

      // After reload, instance should have new data
      config.reload();
      expect(config.agents).toEqual([AI_AGENT.Claude]);
      expect(config.userId).toBe('reloaded-user-id');
      expect(config.telemetry).toBe('disabled');
      expect(config.attribution).toBe('enabled');
    });
  });

  describe('setAgents', () => {
    it('should set agents list', () => {
      const config = GlobalConfigManager.createDefault();

      config.setAgents([AI_AGENT.Claude, AI_AGENT.Gemini]);

      expect(config.agents).toEqual([AI_AGENT.Claude, AI_AGENT.Gemini]);
    });

    it('should persist agents to disk', () => {
      const config = GlobalConfigManager.createDefault();

      config.setAgents([AI_AGENT.Gemini]);

      const jsonData = JSON.parse(
        readFileSync(join(testDir, GLOBAL_CONFIG_FILENAME), 'utf8')
      );
      expect(jsonData.agents).toEqual([AI_AGENT.Gemini]);
    });

    it('should replace existing agents', () => {
      const config = GlobalConfigManager.createDefault();
      config.setAgents([AI_AGENT.Claude]);

      config.setAgents([AI_AGENT.Gemini, AI_AGENT.Codex]);

      expect(config.agents).toEqual([AI_AGENT.Gemini, AI_AGENT.Codex]);
    });

    it('should allow empty agents list', () => {
      const config = GlobalConfigManager.createDefault();
      config.setAgents([AI_AGENT.Claude]);

      config.setAgents([]);

      expect(config.agents).toEqual([]);
    });
  });

  describe('setTelemetry', () => {
    it('should set telemetry status to enabled', () => {
      const config = GlobalConfigManager.createDefault();

      config.setTelemetry('enabled');

      expect(config.telemetry).toBe('enabled');
    });

    it('should set telemetry status to disabled', () => {
      const config = GlobalConfigManager.createDefault();

      config.setTelemetry('disabled');

      expect(config.telemetry).toBe('disabled');
    });

    it('should persist telemetry status to disk', () => {
      const config = GlobalConfigManager.createDefault();

      config.setTelemetry('disabled');

      const jsonData = JSON.parse(
        readFileSync(join(testDir, GLOBAL_CONFIG_FILENAME), 'utf8')
      );
      expect(jsonData.telemetry).toBe('disabled');
    });
  });

  describe('setAttribution', () => {
    it('should set attribution to enabled', () => {
      const config = GlobalConfigManager.createDefault();

      config.setAttribution('enabled');

      expect(config.attribution).toBe('enabled');
    });

    it('should set attribution to disabled', () => {
      const config = GlobalConfigManager.createDefault();

      config.setAttribution('disabled');

      expect(config.attribution).toBe('disabled');
    });

    it('should set attribution to unknown', () => {
      const config = GlobalConfigManager.createDefault();
      config.setAttribution('enabled');

      config.setAttribution('unknown');

      expect(config.attribution).toBe('unknown');
    });

    it('should persist attribution to disk', () => {
      const config = GlobalConfigManager.createDefault();

      config.setAttribution('enabled');

      const jsonData = JSON.parse(
        readFileSync(join(testDir, GLOBAL_CONFIG_FILENAME), 'utf8')
      );
      expect(jsonData.attribution).toBe('enabled');
    });
  });

  describe('isAttributionEnabled', () => {
    it('should return true when attribution is enabled', () => {
      const config = GlobalConfigManager.createDefault();
      config.setAttribution('enabled');

      expect(config.isAttributionEnabled()).toBe(true);
    });

    it('should return false when attribution is disabled', () => {
      const config = GlobalConfigManager.createDefault();
      config.setAttribution('disabled');

      expect(config.isAttributionEnabled()).toBe(false);
    });

    it('should return false when attribution is unknown', () => {
      const config = GlobalConfigManager.createDefault();
      // Default is unknown
      expect(config.isAttributionEnabled()).toBe(false);
    });
  });

  describe('addProject', () => {
    const createProject = (id: string, path: string) => ({
      id,
      path,
      repositoryName: `repo-${id}`,
      languages: ['typescript'] as Language[],
      packageManagers: ['npm'] as PackageManager[],
      taskManagers: [] as TaskManager[],
    });

    it('should add a new project', () => {
      const config = GlobalConfigManager.createDefault();
      const project = createProject('proj-1', '/path/to/project1');

      config.addProject(project);

      expect(config.projects).toHaveLength(1);
      expect(config.projects[0]).toEqual(project);
    });

    it('should add multiple projects', () => {
      const config = GlobalConfigManager.createDefault();
      const project1 = createProject('proj-1', '/path/to/project1');
      const project2 = createProject('proj-2', '/path/to/project2');

      config.addProject(project1);
      config.addProject(project2);

      expect(config.projects).toHaveLength(2);
      expect(config.projects[0]).toEqual(project1);
      expect(config.projects[1]).toEqual(project2);
    });

    it('should update existing project by id', () => {
      const config = GlobalConfigManager.createDefault();
      const project = createProject('proj-1', '/path/to/project1');
      config.addProject(project);

      const updatedProject = {
        ...project,
        path: '/new/path/to/project1',
        repositoryName: 'updated-repo',
      };
      config.addProject(updatedProject);

      expect(config.projects).toHaveLength(1);
      expect(config.projects[0].path).toBe('/new/path/to/project1');
      expect(config.projects[0].repositoryName).toBe('updated-repo');
    });

    it('should persist projects to disk', () => {
      const config = GlobalConfigManager.createDefault();
      const project = createProject('proj-1', '/path/to/project1');

      config.addProject(project);

      const jsonData = JSON.parse(
        readFileSync(join(testDir, GLOBAL_CONFIG_FILENAME), 'utf8')
      );
      expect(jsonData.projects).toHaveLength(1);
      expect(jsonData.projects[0].id).toBe('proj-1');
    });
  });

  describe('removeProject', () => {
    const createProject = (id: string, path: string) => ({
      id,
      path,
      repositoryName: `repo-${id}`,
      languages: ['typescript'] as Language[],
      packageManagers: ['npm'] as PackageManager[],
      taskManagers: [] as TaskManager[],
    });

    it('should remove project by id', () => {
      const config = GlobalConfigManager.createDefault();
      const project1 = createProject('proj-1', '/path/to/project1');
      const project2 = createProject('proj-2', '/path/to/project2');
      config.addProject(project1);
      config.addProject(project2);

      config.removeProject('proj-1');

      expect(config.projects).toHaveLength(1);
      expect(config.projects[0].id).toBe('proj-2');
    });

    it('should handle non-existent project id gracefully', () => {
      const config = GlobalConfigManager.createDefault();
      const project = createProject('proj-1', '/path/to/project1');
      config.addProject(project);

      // Should not throw
      expect(() => config.removeProject('non-existent')).not.toThrow();

      // Projects should remain unchanged
      expect(config.projects).toHaveLength(1);
    });

    it('should persist removal to disk', () => {
      const config = GlobalConfigManager.createDefault();
      const project = createProject('proj-1', '/path/to/project1');
      config.addProject(project);

      config.removeProject('proj-1');

      const jsonData = JSON.parse(
        readFileSync(join(testDir, GLOBAL_CONFIG_FILENAME), 'utf8')
      );
      expect(jsonData.projects).toHaveLength(0);
    });

    it('should not save when project does not exist', () => {
      const config = GlobalConfigManager.createDefault();
      const originalUpdatedAt = config.updatedAt;

      // Wait a bit
      return new Promise<void>(resolve => {
        setTimeout(() => {
          config.removeProject('non-existent');

          // updatedAt should not change since save wasn't called
          expect(config.updatedAt).toBe(originalUpdatedAt);
          resolve();
        }, 10);
      });
    });
  });

  describe('getProject', () => {
    const createProject = (id: string, path: string) => ({
      id,
      path,
      repositoryName: `repo-${id}`,
      languages: ['typescript'] as Language[],
      packageManagers: ['npm'] as PackageManager[],
      taskManagers: [] as TaskManager[],
    });

    it('should find project by id', () => {
      const config = GlobalConfigManager.createDefault();
      const project = createProject('proj-1', '/path/to/project1');
      config.addProject(project);

      const found = config.getProject('proj-1');

      expect(found).toEqual(project);
    });

    it('should return undefined when project not found', () => {
      const config = GlobalConfigManager.createDefault();
      const project = createProject('proj-1', '/path/to/project1');
      config.addProject(project);

      const found = config.getProject('non-existent');

      expect(found).toBeUndefined();
    });

    it('should return undefined when no projects exist', () => {
      const config = GlobalConfigManager.createDefault();

      const found = config.getProject('any-id');

      expect(found).toBeUndefined();
    });
  });

  describe('getProjectByPath', () => {
    const createProject = (id: string, path: string) => ({
      id,
      path,
      repositoryName: `repo-${id}`,
      languages: ['typescript'] as Language[],
      packageManagers: ['npm'] as PackageManager[],
      taskManagers: [] as TaskManager[],
    });

    it('should find project by path', () => {
      const config = GlobalConfigManager.createDefault();
      const project = createProject('proj-1', '/path/to/project1');
      config.addProject(project);

      const found = config.getProjectByPath('/path/to/project1');

      expect(found).toEqual(project);
    });

    it('should return undefined when path not found', () => {
      const config = GlobalConfigManager.createDefault();
      const project = createProject('proj-1', '/path/to/project1');
      config.addProject(project);

      const found = config.getProjectByPath('/different/path');

      expect(found).toBeUndefined();
    });

    it('should return undefined when no projects exist', () => {
      const config = GlobalConfigManager.createDefault();

      const found = config.getProjectByPath('/any/path');

      expect(found).toBeUndefined();
    });
  });

  describe('toJSON', () => {
    it('should return a copy of the data', () => {
      const config = GlobalConfigManager.createDefault();
      config.setAgents([AI_AGENT.Claude]);
      config.setTelemetry('disabled');

      const json = config.toJSON();

      expect(json.version).toBe(CURRENT_GLOBAL_CONFIG_VERSION);
      expect(json.agents).toEqual([AI_AGENT.Claude]);
      expect(json.telemetry).toBe('disabled');
      expect(json.userId).toBe('mock-user-id-12345');
    });

    it('should return a deep clone, not a reference', () => {
      const config = GlobalConfigManager.createDefault();

      const json = config.toJSON();
      json.agents.push(AI_AGENT.Claude);
      json.projects.push({
        id: 'test',
        path: '/test',
        repositoryName: 'test',
        languages: [],
        packageManagers: [],
        taskManagers: [],
      });

      // Original should be unchanged
      expect(config.agents).toEqual([]);
      expect(config.projects).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('should throw GlobalConfigLoadError for invalid JSON', () => {
      mkdirSync(testDir, { recursive: true });
      writeFileSync(
        join(testDir, GLOBAL_CONFIG_FILENAME),
        'invalid json content {'
      );

      expect(() => GlobalConfigManager.load()).toThrow(GlobalConfigLoadError);
    });

    it('should throw GlobalConfigValidationError for invalid schema', () => {
      mkdirSync(testDir, { recursive: true });
      writeFileSync(
        join(testDir, GLOBAL_CONFIG_FILENAME),
        JSON.stringify({
          version: CURRENT_GLOBAL_CONFIG_VERSION,
          // Missing required fields
        })
      );

      expect(() => GlobalConfigManager.load()).toThrow(
        GlobalConfigValidationError
      );
    });

    it('should throw GlobalConfigValidationError for invalid telemetry value', () => {
      const now = new Date().toISOString();
      mkdirSync(testDir, { recursive: true });
      writeFileSync(
        join(testDir, GLOBAL_CONFIG_FILENAME),
        JSON.stringify({
          version: CURRENT_GLOBAL_CONFIG_VERSION,
          agents: [],
          userId: 'test-user',
          telemetry: 'invalid-value', // Invalid value
          attribution: 'unknown',
          createdAt: now,
          updatedAt: now,
          projects: [],
        })
      );

      expect(() => GlobalConfigManager.load()).toThrow(
        GlobalConfigValidationError
      );
    });

    it('should throw GlobalConfigValidationError for invalid agent in array', () => {
      const now = new Date().toISOString();
      mkdirSync(testDir, { recursive: true });
      writeFileSync(
        join(testDir, GLOBAL_CONFIG_FILENAME),
        JSON.stringify({
          version: CURRENT_GLOBAL_CONFIG_VERSION,
          agents: ['invalid-agent'], // Invalid agent
          userId: 'test-user',
          telemetry: 'enabled',
          attribution: 'unknown',
          createdAt: now,
          updatedAt: now,
          projects: [],
        })
      );

      expect(() => GlobalConfigManager.load()).toThrow(
        GlobalConfigValidationError
      );
    });

    it('should throw GlobalConfigValidationError for invalid timestamp format', () => {
      mkdirSync(testDir, { recursive: true });
      writeFileSync(
        join(testDir, GLOBAL_CONFIG_FILENAME),
        JSON.stringify({
          version: CURRENT_GLOBAL_CONFIG_VERSION,
          agents: [],
          userId: 'test-user',
          telemetry: 'enabled',
          attribution: 'unknown',
          createdAt: 'not-a-date', // Invalid timestamp
          updatedAt: 'also-not-a-date',
          projects: [],
        })
      );

      expect(() => GlobalConfigManager.load()).toThrow(
        GlobalConfigValidationError
      );
    });
  });

  describe('migration', () => {
    it('should preserve data when already at current version', () => {
      const now = new Date().toISOString();
      const originalData = {
        version: CURRENT_GLOBAL_CONFIG_VERSION,
        agents: [AI_AGENT.Claude],
        userId: 'preserved-user-id',
        telemetry: 'disabled',
        attribution: 'enabled',
        createdAt: now,
        updatedAt: now,
        projects: [
          {
            id: 'proj-1',
            path: '/path/to/project',
            repositoryName: 'my-repo',
            languages: ['typescript'],
            packageManagers: ['npm'],
            taskManagers: [],
          },
        ],
      };

      mkdirSync(testDir, { recursive: true });
      writeFileSync(
        join(testDir, GLOBAL_CONFIG_FILENAME),
        JSON.stringify(originalData, null, 2)
      );

      const config = GlobalConfigManager.load();

      // All data should be preserved
      expect(config.version).toBe(CURRENT_GLOBAL_CONFIG_VERSION);
      expect(config.agents).toEqual([AI_AGENT.Claude]);
      expect(config.userId).toBe('preserved-user-id');
      expect(config.telemetry).toBe('disabled');
      expect(config.attribution).toBe('enabled');
      expect(config.projects).toHaveLength(1);
      expect(config.projects[0].id).toBe('proj-1');
    });

    // Note: Future migration tests would go here when new versions are added
    // For now, version 1.0 is the only version, so migration is a pass-through
  });

  describe('getters', () => {
    it('should return correct version', () => {
      const config = GlobalConfigManager.createDefault();
      expect(config.version).toBe(CURRENT_GLOBAL_CONFIG_VERSION);
    });

    it('should return correct userId', () => {
      const config = GlobalConfigManager.createDefault();
      expect(config.userId).toBe('mock-user-id-12345');
    });

    it('should return correct createdAt', () => {
      const config = GlobalConfigManager.createDefault();
      const createdAt = config.createdAt;

      // Should be a valid ISO date string
      expect(new Date(createdAt).toISOString()).toBe(createdAt);
    });

    it('should return correct updatedAt', () => {
      const config = GlobalConfigManager.createDefault();
      const updatedAt = config.updatedAt;

      // Should be a valid ISO date string
      expect(new Date(updatedAt).toISOString()).toBe(updatedAt);
    });
  });

  describe('edge cases', () => {
    it('should handle empty projects array', () => {
      const now = new Date().toISOString();
      mkdirSync(testDir, { recursive: true });
      writeFileSync(
        join(testDir, GLOBAL_CONFIG_FILENAME),
        JSON.stringify({
          version: CURRENT_GLOBAL_CONFIG_VERSION,
          agents: [],
          userId: 'test-user',
          telemetry: 'enabled',
          attribution: 'unknown',
          createdAt: now,
          updatedAt: now,
          projects: [],
        })
      );

      const config = GlobalConfigManager.load();

      expect(config.projects).toEqual([]);
      expect(config.getProject('any')).toBeUndefined();
      expect(config.getProjectByPath('/any')).toBeUndefined();
    });

    it('should handle all valid AI_AGENT values', () => {
      const config = GlobalConfigManager.createDefault();
      const allAgents = [
        AI_AGENT.Claude,
        AI_AGENT.Codex,
        AI_AGENT.Cursor,
        AI_AGENT.Gemini,
        AI_AGENT.Qwen,
      ];

      config.setAgents(allAgents);

      expect(config.agents).toEqual(allAgents);

      const jsonData = JSON.parse(
        readFileSync(join(testDir, GLOBAL_CONFIG_FILENAME), 'utf8')
      );
      expect(jsonData.agents).toEqual(allAgents);
    });

    it('should handle project with all language types', () => {
      const config = GlobalConfigManager.createDefault();
      const project = {
        id: 'multi-lang',
        path: '/multi/lang/project',
        repositoryName: 'multi-lang-repo',
        languages: ['typescript', 'python', 'rust', 'go'] as Language[],
        packageManagers: ['npm', 'pip', 'cargo', 'maven'] as PackageManager[],
        taskManagers: ['make', 'just'] as TaskManager[],
      };

      config.addProject(project);

      expect(config.projects[0]).toEqual(project);
    });
  });
});
