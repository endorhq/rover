import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { infoCommand } from '../info.js';

// Store paths for mocking
let testDataDir: string;

// Mock rover-core
vi.mock('rover-core', async () => {
  const actual = await vi.importActual('rover-core');
  return {
    ...actual,
    getDataDir: vi.fn().mockImplementation(() => testDataDir),
    ProjectStore: vi.fn().mockImplementation(() => ({
      list: vi.fn().mockReturnValue([]),
      getProjectsPath: vi.fn().mockReturnValue(join(testDataDir, 'projects')),
      getByPath: vi.fn().mockReturnValue(null),
      getByName: vi.fn().mockReturnValue(null),
      get: vi.fn().mockReturnValue(null),
    })),
    showTitle: vi.fn(),
    showProperties: vi.fn(),
    showTips: vi.fn(),
  };
});

// Mock telemetry
vi.mock('../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    eventInfo: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock context
vi.mock('../../lib/context.js', () => ({
  isJsonMode: vi.fn().mockReturnValue(false),
  setJsonMode: vi.fn(),
}));

// Mock exit utilities
vi.mock('../../utils/exit.js', () => ({
  exitWithError: vi.fn().mockImplementation(() => {}),
  exitWithSuccess: vi.fn().mockImplementation(() => {}),
}));

describe('info command', () => {
  let originalCwd: string;

  beforeEach(() => {
    // Create temp directory for testing
    testDataDir = mkdtempSync(join(tmpdir(), 'rover-info-test-'));
    originalCwd = process.cwd();

    // Create basic directory structure
    mkdirSync(join(testDataDir, 'projects'), { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDataDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('Basic info output', () => {
    it('should display info with no projects', async () => {
      const { exitWithSuccess } = await import('../../utils/exit.js');

      await infoCommand();

      expect(exitWithSuccess).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          success: true,
          storePath: expect.any(String),
          projectCount: expect.any(Number),
          projects: expect.any(Array),
        }),
        expect.objectContaining({
          telemetry: expect.anything(),
        })
      );
    });

    it('should display store information', async () => {
      const { showTitle, showProperties } = await import('rover-core');

      await infoCommand();

      expect(showTitle).toHaveBeenCalledWith('Rover Store Information');
      expect(showProperties).toHaveBeenCalledWith(
        expect.objectContaining({
          'Store Path': testDataDir,
        })
      );
    });
  });

  describe('Info with registered projects', () => {
    it('should display project information when projects exist', async () => {
      // Setup mock with a project
      const { ProjectStore } = await import('rover-core');
      const mockProject = {
        id: 'test-project-id',
        repositoryName: 'test-repo',
        path: '/path/to/project',
      };

      vi.mocked(ProjectStore).mockImplementation(
        () =>
          ({
            list: vi.fn().mockReturnValue([mockProject]),
            getProjectsPath: vi
              .fn()
              .mockReturnValue(join(testDataDir, 'projects')),
            getByPath: vi.fn().mockReturnValue(null),
            getByName: vi.fn().mockReturnValue(null),
            get: vi.fn().mockReturnValue(null),
          }) as any
      );

      // Create project directory structure
      mkdirSync(join(testDataDir, 'projects', 'test-project-id', 'tasks'), {
        recursive: true,
      });

      const { showTitle } = await import('rover-core');

      await infoCommand();

      expect(showTitle).toHaveBeenCalledWith('Projects');
    });

    it('should calculate disk usage for projects', async () => {
      // Setup mock with a project
      const { ProjectStore } = await import('rover-core');
      const mockProject = {
        id: 'test-project-id',
        repositoryName: 'test-repo',
        path: '/path/to/project',
      };

      vi.mocked(ProjectStore).mockImplementation(
        () =>
          ({
            list: vi.fn().mockReturnValue([mockProject]),
            getProjectsPath: vi
              .fn()
              .mockReturnValue(join(testDataDir, 'projects')),
            getByPath: vi.fn().mockReturnValue(null),
            getByName: vi.fn().mockReturnValue(null),
            get: vi.fn().mockReturnValue(null),
          }) as any
      );

      // Create project directory with some files
      const projectPath = join(
        testDataDir,
        'projects',
        'test-project-id',
        'tasks'
      );
      mkdirSync(projectPath, { recursive: true });
      writeFileSync(join(projectPath, 'test-file.txt'), 'test content');

      const { exitWithSuccess } = await import('../../utils/exit.js');

      await infoCommand();

      expect(exitWithSuccess).toHaveBeenCalled();
    });

    it('should count tasks correctly', async () => {
      // Setup mock with a project
      const { ProjectStore } = await import('rover-core');
      const mockProject = {
        id: 'test-project-id',
        repositoryName: 'test-repo',
        path: '/path/to/project',
      };

      vi.mocked(ProjectStore).mockImplementation(
        () =>
          ({
            list: vi.fn().mockReturnValue([mockProject]),
            getProjectsPath: vi
              .fn()
              .mockReturnValue(join(testDataDir, 'projects')),
            getByPath: vi.fn().mockReturnValue(null),
            getByName: vi.fn().mockReturnValue(null),
            get: vi.fn().mockReturnValue(null),
          }) as any
      );

      // Create project directory with task directories
      const tasksPath = join(
        testDataDir,
        'projects',
        'test-project-id',
        'tasks'
      );
      mkdirSync(join(tasksPath, '1'), { recursive: true });
      mkdirSync(join(tasksPath, '2'), { recursive: true });
      mkdirSync(join(tasksPath, '3'), { recursive: true });

      const { exitWithSuccess } = await import('../../utils/exit.js');

      await infoCommand();

      expect(exitWithSuccess).toHaveBeenCalled();
    });
  });

  describe('JSON output format', () => {
    it('should output JSON when --json flag is provided', async () => {
      const { isJsonMode } = await import('../../lib/context.js');
      vi.mocked(isJsonMode).mockReturnValue(true);

      const { exitWithSuccess } = await import('../../utils/exit.js');

      await infoCommand({ json: true });

      expect(exitWithSuccess).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          success: true,
          storePath: expect.any(String),
          projectCount: expect.any(Number),
          projects: expect.any(Array),
        }),
        expect.objectContaining({
          telemetry: expect.anything(),
        })
      );
    });
  });

  describe('Telemetry integration', () => {
    it('should call telemetry eventInfo on command execution', async () => {
      const { getTelemetry } = await import('../../lib/telemetry.js');
      const mockTelemetry = getTelemetry();

      await infoCommand();

      expect(mockTelemetry?.eventInfo).toHaveBeenCalled();
    });
  });
});
