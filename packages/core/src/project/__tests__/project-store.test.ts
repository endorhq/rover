import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GlobalProject } from 'rover-schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('ProjectStore', () => {
  let testDataDir: string;
  let testConfigDir: string;
  let testProjectDir: string;
  let mockConfig: {
    projects: GlobalProject[];
    addProject: ReturnType<typeof vi.fn>;
    removeProject: ReturnType<typeof vi.fn>;
    getProjectByPath: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetModules();

    // Create unique test directories
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    testDataDir = join(tmpdir(), `rover-data-test-${uniqueId}`);
    testConfigDir = join(tmpdir(), `rover-config-test-${uniqueId}`);
    testProjectDir = join(tmpdir(), `rover-project-test-${uniqueId}`);

    mkdirSync(testDataDir, { recursive: true });
    mkdirSync(testConfigDir, { recursive: true });
    mkdirSync(testProjectDir, { recursive: true });

    // Create mock config
    mockConfig = {
      projects: [],
      addProject: vi.fn((project: GlobalProject) => {
        mockConfig.projects.push(project);
      }),
      removeProject: vi.fn((id: string) => {
        mockConfig.projects = mockConfig.projects.filter(p => p.id !== id);
      }),
      getProjectByPath: vi.fn((path: string) => {
        return mockConfig.projects.find(p => p.path === path);
      }),
    };

    // Mock paths module
    vi.doMock('../../paths.js', () => ({
      getDataDir: () => testDataDir,
      getConfigDir: () => testConfigDir,
    }));

    // Mock global-config module
    vi.doMock('../../files/global-config.js', () => ({
      GlobalConfigManager: {
        load: vi.fn(() => mockConfig),
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock('../../paths.js');
    vi.doUnmock('../../files/global-config.js');

    // Clean up test directories
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
    if (existsSync(testConfigDir)) {
      rmSync(testConfigDir, { recursive: true, force: true });
    }
    if (existsSync(testProjectDir)) {
      rmSync(testProjectDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create projects folder if it does not exist', async () => {
      const { ProjectStore } = await import('../project-store.js');

      new ProjectStore();

      const projectsPath = join(testDataDir, 'projects');
      expect(existsSync(projectsPath)).toBe(true);
    });

    it('should not fail if projects folder already exists', async () => {
      const projectsPath = join(testDataDir, 'projects');
      mkdirSync(projectsPath, { recursive: true });

      const { ProjectStore } = await import('../project-store.js');

      expect(() => new ProjectStore()).not.toThrow();
    });

    it('should load global configuration', async () => {
      const { ProjectStore } = await import('../project-store.js');
      const { GlobalConfigManager } = await import(
        '../../files/global-config.js'
      );

      new ProjectStore();

      expect(GlobalConfigManager.load).toHaveBeenCalled();
    });

    it('should throw ProjectStoreLoadError when config fails to load', async () => {
      // Re-mock with error
      vi.doMock('../../files/global-config.js', () => ({
        GlobalConfigManager: {
          load: vi.fn(() => {
            throw new Error('Config load failed');
          }),
        },
      }));

      const { ProjectStore, ProjectStoreLoadError } = await import(
        '../project-store.js'
      );

      expect(() => new ProjectStore()).toThrow(ProjectStoreLoadError);
    });
  });

  describe('list', () => {
    it('should return empty array when no projects are registered', async () => {
      const { ProjectStore } = await import('../project-store.js');

      const store = new ProjectStore();
      const result = store.list();

      expect(result).toEqual([]);
    });

    it('should return projects from config', async () => {
      const existingProjects: GlobalProject[] = [
        {
          id: 'test-project-123',
          path: '/test/path',
          repositoryName: 'test-project',
          languages: ['typescript'],
          packageManagers: ['npm'],
          taskManagers: [],
        },
      ];
      mockConfig.projects = existingProjects;

      const { ProjectStore } = await import('../project-store.js');

      const store = new ProjectStore();
      const result = store.list();

      expect(result).toEqual(existingProjects);
    });

    it('should return multiple projects', async () => {
      const existingProjects: GlobalProject[] = [
        {
          id: 'project-1',
          path: '/path/1',
          repositoryName: 'project-1',
          languages: [],
          packageManagers: [],
          taskManagers: [],
        },
        {
          id: 'project-2',
          path: '/path/2',
          repositoryName: 'project-2',
          languages: [],
          packageManagers: [],
          taskManagers: [],
        },
      ];
      mockConfig.projects = existingProjects;

      const { ProjectStore } = await import('../project-store.js');

      const store = new ProjectStore();
      const result = store.list();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('project-1');
      expect(result[1].id).toBe('project-2');
    });
  });

  describe('add', () => {
    it('should generate project ID from name and path', async () => {
      const { ProjectStore } = await import('../project-store.js');

      const store = new ProjectStore();
      await store.add('my-project', testProjectDir, false);

      expect(mockConfig.addProject).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^my-project-[a-f0-9]{8}$/),
        })
      );
    });

    it('should use absolute path for project', async () => {
      const { ProjectStore } = await import('../project-store.js');

      const store = new ProjectStore();
      await store.add('test', testProjectDir, false);

      expect(mockConfig.addProject).toHaveBeenCalledWith(
        expect.objectContaining({
          path: testProjectDir,
        })
      );
    });

    it('should set empty arrays when autodetect is false', async () => {
      const { ProjectStore } = await import('../project-store.js');

      const store = new ProjectStore();
      await store.add('test', testProjectDir, false);

      expect(mockConfig.addProject).toHaveBeenCalledWith(
        expect.objectContaining({
          languages: [],
          packageManagers: [],
          taskManagers: [],
        })
      );
    });

    it('should detect environment when autodetect is true', async () => {
      // Create marker files in the test project directory
      writeFileSync(join(testProjectDir, 'tsconfig.json'), '{}');
      writeFileSync(join(testProjectDir, 'package.json'), '{}');
      writeFileSync(join(testProjectDir, 'package-lock.json'), '{}');
      writeFileSync(join(testProjectDir, 'Makefile'), '');

      const { ProjectStore } = await import('../project-store.js');

      const store = new ProjectStore();
      await store.add('ts-project', testProjectDir, true);

      expect(mockConfig.addProject).toHaveBeenCalledWith(
        expect.objectContaining({
          languages: expect.arrayContaining(['typescript', 'javascript']),
          packageManagers: expect.arrayContaining(['npm']),
          taskManagers: expect.arrayContaining(['make']),
        })
      );
    });

    it('should add project to config', async () => {
      const { ProjectStore } = await import('../project-store.js');

      const store = new ProjectStore();
      await store.add('new-project', testProjectDir, false);

      expect(mockConfig.addProject).toHaveBeenCalledTimes(1);
      expect(mockConfig.addProject).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryName: 'new-project',
        })
      );
    });

    it('should return ProjectManager for the added project', async () => {
      const { ProjectStore } = await import('../project-store.js');
      const { ProjectManager } = await import('../project.js');

      const store = new ProjectStore();
      const result = await store.add('test-project', testProjectDir, false);

      expect(result).toBeInstanceOf(ProjectManager);
      expect(result.name).toBe('test-project');
      expect(result.path).toBe(testProjectDir);
    });

    it('should sanitize invalid characters in project name for ID', async () => {
      const { ProjectStore } = await import('../project-store.js');

      const store = new ProjectStore();
      await store.add('my/project:name', testProjectDir, false);

      expect(mockConfig.addProject).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringMatching(/^my-project-name-[a-f0-9]{8}$/),
        })
      );
    });
  });

  describe('get', () => {
    it('should return ProjectManager when found by ID', async () => {
      const existingProject: GlobalProject = {
        id: 'test-project-123',
        path: '/test/path',
        repositoryName: 'test-project',
        languages: ['typescript'],
        packageManagers: ['npm'],
        taskManagers: [],
      };
      mockConfig.projects = [existingProject];

      const { ProjectStore } = await import('../project-store.js');
      const { ProjectManager } = await import('../project.js');

      const store = new ProjectStore();
      const result = store.get('test-project-123');

      expect(result).toBeInstanceOf(ProjectManager);
      expect(result?.id).toBe('test-project-123');
      expect(result?.name).toBe('test-project');
    });

    it('should return undefined when project ID is not found', async () => {
      mockConfig.projects = [];

      const { ProjectStore } = await import('../project-store.js');

      const store = new ProjectStore();
      const result = store.get('non-existent-id');

      expect(result).toBeUndefined();
    });
  });

  describe('getByPath', () => {
    it('should return ProjectManager when found by path', async () => {
      const existingProject: GlobalProject = {
        id: 'test-project-123',
        path: '/test/path',
        repositoryName: 'test-project',
        languages: [],
        packageManagers: [],
        taskManagers: [],
      };
      mockConfig.projects = [existingProject];

      const { ProjectStore } = await import('../project-store.js');
      const { ProjectManager } = await import('../project.js');

      const store = new ProjectStore();
      const result = store.getByPath('/test/path');

      expect(result).toBeInstanceOf(ProjectManager);
      expect(result?.path).toBe('/test/path');
    });

    it('should return undefined when path is not found', async () => {
      mockConfig.projects = [];

      const { ProjectStore } = await import('../project-store.js');

      const store = new ProjectStore();
      const result = store.getByPath('/non/existent/path');

      expect(result).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('should call removeProject on config', async () => {
      const existingProject: GlobalProject = {
        id: 'project-to-remove',
        path: '/test/path',
        repositoryName: 'test-project',
        languages: [],
        packageManagers: [],
        taskManagers: [],
      };
      mockConfig.projects = [existingProject];

      const { ProjectStore } = await import('../project-store.js');

      const store = new ProjectStore();
      store.remove('project-to-remove');

      expect(mockConfig.removeProject).toHaveBeenCalledWith(
        'project-to-remove'
      );
    });

    it('should delete project folders when they exist', async () => {
      const projectId = 'project-with-folders';
      const projectFolderPath = join(testDataDir, 'projects', projectId);

      // Create project folders
      mkdirSync(join(projectFolderPath, 'tasks'), { recursive: true });
      mkdirSync(join(projectFolderPath, 'workspaces'), { recursive: true });
      mkdirSync(join(projectFolderPath, 'logs'), { recursive: true });

      expect(existsSync(projectFolderPath)).toBe(true);

      const { ProjectStore } = await import('../project-store.js');

      const store = new ProjectStore();
      store.remove(projectId);

      expect(existsSync(projectFolderPath)).toBe(false);
    });

    it('should handle non-existent project folders gracefully', async () => {
      const projectId = 'project-without-folders';
      const projectFolderPath = join(testDataDir, 'projects', projectId);

      expect(existsSync(projectFolderPath)).toBe(false);

      const { ProjectStore } = await import('../project-store.js');

      const store = new ProjectStore();

      // Should not throw when folders don't exist
      expect(() => store.remove(projectId)).not.toThrow();
      expect(mockConfig.removeProject).toHaveBeenCalledWith(projectId);
    });
  });

  describe('getProjectsPath', () => {
    it('should return correct base path for projects', async () => {
      const { ProjectStore } = await import('../project-store.js');

      const store = new ProjectStore();
      const result = store.getProjectsPath();

      expect(result).toBe(join(testDataDir, 'projects'));
    });
  });
});
