import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GlobalProject } from 'rover-schemas';

describe('CLI Context', () => {
  let mockConfig: {
    projects: GlobalProject[];
    addProject: ReturnType<typeof vi.fn>;
    removeProject: ReturnType<typeof vi.fn>;
    getProjectByPath: ReturnType<typeof vi.fn>;
  };

  const mockProject1: GlobalProject = {
    id: 'test-project-abc123',
    path: '/test/project/path',
    repositoryName: 'test-project',
    languages: ['typescript'],
    packageManagers: ['npm'],
    taskManagers: [],
    nextTaskId: 1,
  };

  const mockProject2: GlobalProject = {
    id: 'another-project-def456',
    path: '/another/project/path',
    repositoryName: 'another-project',
    languages: ['javascript'],
    packageManagers: ['yarn'],
    taskManagers: [],
    nextTaskId: 1,
  };

  beforeEach(() => {
    vi.resetModules();

    // Create mock config
    mockConfig = {
      projects: [mockProject1, mockProject2],
      addProject: vi.fn(),
      removeProject: vi.fn(),
      getProjectByPath: vi.fn((path: string) => {
        return mockConfig.projects.find(p => p.path === path);
      }),
    };

    // Mock paths module
    vi.doMock('rover-core', async importOriginal => {
      const actual = (await importOriginal()) as Record<string, unknown>;
      return {
        ...actual,
        ProjectStore: vi.fn().mockImplementation(() => ({
          get: (id: string) => {
            const project = mockConfig.projects.find(p => p.id === id);
            if (!project) return undefined;
            return {
              id: project.id,
              name: project.repositoryName,
              path: project.path,
            };
          },
          getByPath: (path: string) => {
            const project = mockConfig.projects.find(p => p.path === path);
            if (!project) return undefined;
            return {
              id: project.id,
              name: project.repositoryName,
              path: project.path,
            };
          },
        })),
      };
    });
  });

  afterEach(() => {
    vi.doUnmock('rover-core');
    // Clear ROVER_PROJECT env var if set
    delete process.env.ROVER_PROJECT;
  });

  describe('resolveProjectContext', () => {
    it('should return context project if already set', async () => {
      const { initCLIContext, resolveProjectContext, resetCLIContext } =
        await import('../context.js');

      const mockProjectManager = {
        id: 'context-project',
        name: 'Context Project',
        path: '/context/path',
      };

      initCLIContext({
        jsonMode: false,
        verbose: false,
        project: mockProjectManager as any,
        inGitRepo: true,
      });

      const result = await resolveProjectContext('some-other-project');

      // Should return context project, not look up the other one
      expect(result).toBe(mockProjectManager);

      resetCLIContext();
    });

    it('should look up project by ID when no context project', async () => {
      const { initCLIContext, resolveProjectContext, resetCLIContext } =
        await import('../context.js');

      initCLIContext({
        jsonMode: false,
        verbose: false,
        project: null,
        inGitRepo: false,
      });

      const result = await resolveProjectContext('test-project-abc123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('test-project-abc123');

      resetCLIContext();
    });

    it('should look up project by path when ID not found', async () => {
      const { initCLIContext, resolveProjectContext, resetCLIContext } =
        await import('../context.js');

      initCLIContext({
        jsonMode: false,
        verbose: false,
        project: null,
        inGitRepo: false,
      });

      const result = await resolveProjectContext('/test/project/path');

      expect(result).toBeDefined();
      expect(result?.path).toBe('/test/project/path');

      resetCLIContext();
    });

    it('should throw error when project not found', async () => {
      const { initCLIContext, resolveProjectContext, resetCLIContext } =
        await import('../context.js');

      initCLIContext({
        jsonMode: false,
        verbose: false,
        project: null,
        inGitRepo: false,
      });

      await expect(
        resolveProjectContext('non-existent-project')
      ).rejects.toThrow('Project "non-existent-project" not found');

      resetCLIContext();
    });

    it('should use ROVER_PROJECT env var when no projectOption', async () => {
      const { initCLIContext, resolveProjectContext, resetCLIContext } =
        await import('../context.js');

      process.env.ROVER_PROJECT = 'test-project-abc123';

      initCLIContext({
        jsonMode: false,
        verbose: false,
        project: null,
        inGitRepo: false,
      });

      const result = await resolveProjectContext();

      expect(result).toBeDefined();
      expect(result?.id).toBe('test-project-abc123');

      resetCLIContext();
    });

    it('should prefer projectOption over ROVER_PROJECT env', async () => {
      const { initCLIContext, resolveProjectContext, resetCLIContext } =
        await import('../context.js');

      process.env.ROVER_PROJECT = 'test-project-abc123';

      initCLIContext({
        jsonMode: false,
        verbose: false,
        project: null,
        inGitRepo: false,
      });

      const result = await resolveProjectContext('another-project-def456');

      expect(result).toBeDefined();
      expect(result?.id).toBe('another-project-def456');

      resetCLIContext();
    });

    it('should return null when no override and no context project', async () => {
      const { initCLIContext, resolveProjectContext, resetCLIContext } =
        await import('../context.js');

      initCLIContext({
        jsonMode: false,
        verbose: false,
        project: null,
        inGitRepo: false,
      });

      const result = await resolveProjectContext();

      expect(result).toBeNull();

      resetCLIContext();
    });
  });

  describe('requireProjectContext', () => {
    it('should return project when available', async () => {
      const { initCLIContext, requireProjectContext, resetCLIContext } =
        await import('../context.js');

      const mockProjectManager = {
        id: 'context-project',
        name: 'Context Project',
        path: '/context/path',
      };

      initCLIContext({
        jsonMode: false,
        verbose: false,
        project: mockProjectManager as any,
        inGitRepo: true,
      });

      const result = await requireProjectContext();

      expect(result).toBe(mockProjectManager);

      resetCLIContext();
    });

    it('should throw helpful error when no project context', async () => {
      const { initCLIContext, requireProjectContext, resetCLIContext } =
        await import('../context.js');

      initCLIContext({
        jsonMode: false,
        verbose: false,
        project: null,
        inGitRepo: false,
      });

      await expect(requireProjectContext()).rejects.toThrow(
        /--project.*ROVER_PROJECT/
      );

      resetCLIContext();
    });

    it('should look up project by projectOption when no context', async () => {
      const { initCLIContext, requireProjectContext, resetCLIContext } =
        await import('../context.js');

      initCLIContext({
        jsonMode: false,
        verbose: false,
        project: null,
        inGitRepo: false,
      });

      const result = await requireProjectContext('test-project-abc123');

      expect(result).toBeDefined();
      expect(result.id).toBe('test-project-abc123');

      resetCLIContext();
    });
  });

  describe('context accessors', () => {
    it('isJsonMode should return correct value', async () => {
      const { initCLIContext, isJsonMode, resetCLIContext } = await import(
        '../context.js'
      );

      initCLIContext({
        jsonMode: true,
        verbose: false,
        project: null,
        inGitRepo: false,
      });

      expect(isJsonMode()).toBe(true);

      resetCLIContext();
    });

    it('setJsonMode should update mode', async () => {
      const { initCLIContext, isJsonMode, setJsonMode, resetCLIContext } =
        await import('../context.js');

      initCLIContext({
        jsonMode: false,
        verbose: false,
        project: null,
        inGitRepo: false,
      });

      expect(isJsonMode()).toBe(false);
      setJsonMode(true);
      expect(isJsonMode()).toBe(true);

      resetCLIContext();
    });

    it('isProjectMode should return true when project is set', async () => {
      const { initCLIContext, isProjectMode, resetCLIContext } = await import(
        '../context.js'
      );

      initCLIContext({
        jsonMode: false,
        verbose: false,
        project: { id: 'test' } as any,
        inGitRepo: true,
      });

      expect(isProjectMode()).toBe(true);

      resetCLIContext();
    });

    it('isProjectMode should return false when project is null', async () => {
      const { initCLIContext, isProjectMode, resetCLIContext } = await import(
        '../context.js'
      );

      initCLIContext({
        jsonMode: false,
        verbose: false,
        project: null,
        inGitRepo: false,
      });

      expect(isProjectMode()).toBe(false);

      resetCLIContext();
    });

    it('getDefaultProject should return context project', async () => {
      const { initCLIContext, getDefaultProject, resetCLIContext } =
        await import('../context.js');

      const mockProject = { id: 'test', name: 'Test' } as any;

      initCLIContext({
        jsonMode: false,
        verbose: false,
        project: mockProject,
        inGitRepo: true,
      });

      expect(getDefaultProject()).toBe(mockProject);

      resetCLIContext();
    });
  });

  describe('getCLIContext', () => {
    it('should throw error when context not initialized', async () => {
      const { getCLIContext, resetCLIContext } = await import('../context.js');

      // Ensure context is reset
      resetCLIContext();

      expect(() => getCLIContext()).toThrow('CLI context not initialized');
    });
  });
});
