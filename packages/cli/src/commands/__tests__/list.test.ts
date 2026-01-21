import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearProjectRootCache,
  launchSync,
  TaskDescriptionManager,
} from 'rover-core';
import type { GlobalProject } from 'rover-schemas';
import { listCommand } from '../list.js';

// Store testDir for context mock
let testDir: string;

// Mock project store for global mode testing
const mockProjects: GlobalProject[] = [];
const mockProjectManagers: Map<string, any> = new Map();

// Mock ProjectStore
vi.mock('rover-core', async importOriginal => {
  const actual = await importOriginal<typeof import('rover-core')>();
  return {
    ...actual,
    ProjectStore: vi.fn().mockImplementation(() => ({
      list: () => mockProjects,
      get: (id: string) => mockProjectManagers.get(id),
    })),
  };
});

// Track JSON mode state
let mockJsonMode = false;

// Mock context to control project mode
const mockIsProjectMode = vi.fn().mockReturnValue(true);
const mockResolveProjectContext = vi.fn();

vi.mock('../../lib/context.js', () => ({
  resolveProjectContext: () => mockResolveProjectContext(),
  isJsonMode: () => mockJsonMode,
  isProjectMode: () => mockIsProjectMode(),
  setJsonMode: (value: boolean) => {
    mockJsonMode = value;
  },
}));

// Mock external dependencies
vi.mock('../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    eventListTasks: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock hooks
vi.mock('../../lib/hooks.js', () => ({
  executeHooks: vi.fn(),
}));

describe('list command', () => {
  let originalCwd: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let capturedOutput: string[];

  beforeEach(() => {
    // Clear project root cache to ensure tests use the correct directory
    clearProjectRootCache();

    // Create temp directory with git repo
    testDir = mkdtempSync(join(tmpdir(), 'rover-list-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Initialize git repo
    launchSync('git', ['init']);
    launchSync('git', ['config', 'user.email', 'test@test.com']);
    launchSync('git', ['config', 'user.name', 'Test User']);
    launchSync('git', ['config', 'commit.gpgsign', 'false']);

    // Create initial commit
    writeFileSync('README.md', '# Test');
    launchSync('git', ['add', '.']);
    launchSync('git', ['commit', '-m', 'Initial commit']);

    // Create .rover directory structure
    mkdirSync('.rover/tasks', { recursive: true });

    // Create rover.json to indicate this is a Rover project
    writeFileSync(
      'rover.json',
      JSON.stringify({
        version: '1.2',
        languages: [],
        mcps: [],
        packageManagers: [],
        taskManagers: [],
        attribution: true,
      })
    );

    // Reset mock state
    mockProjects.length = 0;
    mockProjectManagers.clear();

    // Capture console output
    capturedOutput = [];
    consoleLogSpy = vi
      .spyOn(console, 'log')
      .mockImplementation((msg: string) => {
        capturedOutput.push(String(msg));
      });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
    clearProjectRootCache();
    consoleLogSpy.mockRestore();
    mockJsonMode = false;
  });

  // Helper to create a test task
  const createTestTask = (id: number, title: string = 'Test Task') => {
    const taskPath = join(testDir, '.rover', 'tasks', id.toString());
    const task = TaskDescriptionManager.create(taskPath, {
      id,
      title,
      description: 'Test task description',
      inputs: new Map(),
      workflowName: 'swe',
    });

    // Create a git worktree for the task
    const worktreePath = join('.rover', 'tasks', id.toString(), 'workspace');
    const branchName = `rover-task-${id}`;

    launchSync('git', ['worktree', 'add', worktreePath, '-b', branchName]);
    task.setWorkspace(join(testDir, worktreePath), branchName);

    return task;
  };

  // Helper to create a mock project manager
  const createMockProjectManager = (
    projectId: string,
    tasks: TaskDescriptionManager[]
  ) => ({
    id: projectId,
    path: testDir,
    repositoryName: `test-repo-${projectId}`,
    languages: [],
    packageManagers: [],
    taskManagers: [],
    listTasks: () => tasks,
  });

  describe('Scoped view (single project)', () => {
    beforeEach(() => {
      mockIsProjectMode.mockReturnValue(true);
    });

    it('should display tasks for a single project without grouping', async () => {
      const task1 = createTestTask(1, 'First Task');
      const task2 = createTestTask(2, 'Second Task');

      mockResolveProjectContext.mockResolvedValue({
        id: 'test-project-id',
        path: testDir,
        repositoryName: 'test-repo',
        languages: [],
        packageManagers: [],
        taskManagers: [],
        listTasks: () => [task1, task2],
      });

      await listCommand();

      // Verify tasks are listed
      const output = capturedOutput.join('\n');
      expect(output).toContain('First Task');
      expect(output).toContain('Second Task');
      // In scoped mode, no group headers should appear
      expect(output).not.toContain('test-repo');
    });

    it('should show "No tasks found" when project has no tasks', async () => {
      mockResolveProjectContext.mockResolvedValue({
        id: 'test-project-id',
        path: testDir,
        repositoryName: 'test-repo',
        languages: [],
        packageManagers: [],
        taskManagers: [],
        listTasks: () => [],
      });

      await listCommand();

      const output = capturedOutput.join('\n');
      expect(output).toContain('No tasks found');
    });
  });

  describe('Global view (all projects)', () => {
    beforeEach(() => {
      mockIsProjectMode.mockReturnValue(false);
      mockResolveProjectContext.mockResolvedValue(null);
    });

    it('should display tasks grouped by project', async () => {
      // Create tasks for two different projects
      const task1 = createTestTask(1, 'Project A Task 1');
      const task2 = createTestTask(2, 'Project A Task 2');
      const task3 = createTestTask(3, 'Project B Task 1');

      const projectA: GlobalProject = {
        id: 'project-a',
        repositoryName: 'my-app',
        path: '/path/to/my-app',
        languages: [],
        packageManagers: [],
        taskManagers: [],
        nextTaskId: 3,
      };

      const projectB: GlobalProject = {
        id: 'project-b',
        repositoryName: 'other-app',
        path: '/path/to/other-app',
        languages: [],
        packageManagers: [],
        taskManagers: [],
        nextTaskId: 2,
      };

      mockProjects.push(projectA, projectB);

      mockProjectManagers.set('project-a', {
        id: 'project-a',
        name: 'my-app',
        path: '/path/to/my-app',
        listTasks: () => [task1, task2],
      });
      mockProjectManagers.set('project-b', {
        id: 'project-b',
        name: 'other-app',
        path: '/path/to/other-app',
        listTasks: () => [task3],
      });

      await listCommand();

      const output = capturedOutput.join('\n');

      // Verify both project group headers appear
      expect(output).toContain('my-app');
      expect(output).toContain('other-app');

      // Verify tasks appear
      expect(output).toContain('Project A Task 1');
      expect(output).toContain('Project A Task 2');
      expect(output).toContain('Project B Task 1');
    });

    it('should show "No tasks found across all projects" when no projects have tasks', async () => {
      const projectA: GlobalProject = {
        id: 'project-a',
        repositoryName: 'my-app',
        path: '/path/to/my-app',
        languages: [],
        packageManagers: [],
        taskManagers: [],
        nextTaskId: 1,
      };

      mockProjects.push(projectA);
      mockProjectManagers.set('project-a', {
        listTasks: () => [],
      });

      await listCommand();

      const output = capturedOutput.join('\n');
      expect(output).toContain('No tasks found across all projects');
    });

    it('should skip projects with no tasks in group headers', async () => {
      const task1 = createTestTask(1, 'Only Task');

      const projectWithTasks: GlobalProject = {
        id: 'has-tasks',
        repositoryName: 'active-project',
        path: '/path/to/active',
        languages: [],
        packageManagers: [],
        taskManagers: [],
        nextTaskId: 2,
      };

      const projectWithoutTasks: GlobalProject = {
        id: 'no-tasks',
        repositoryName: 'empty-project',
        path: '/path/to/empty',
        languages: [],
        packageManagers: [],
        taskManagers: [],
        nextTaskId: 1,
      };

      mockProjects.push(projectWithTasks, projectWithoutTasks);

      mockProjectManagers.set('has-tasks', {
        id: 'has-tasks',
        name: 'active-project',
        path: '/path/to/active',
        listTasks: () => [task1],
      });
      mockProjectManagers.set('no-tasks', {
        id: 'no-tasks',
        name: 'empty-project',
        path: '/path/to/empty',
        listTasks: () => [],
      });

      await listCommand();

      const output = capturedOutput.join('\n');

      // Project with tasks should appear
      expect(output).toContain('active-project');
      // Project without tasks should not appear as a group header
      expect(output).not.toContain('empty-project');
    });

    it('should warn that watch mode is not supported in global mode', async () => {
      const task1 = createTestTask(1, 'Test Task');

      const projectA: GlobalProject = {
        id: 'project-a',
        repositoryName: 'my-app',
        path: '/path/to/my-app',
        languages: [],
        packageManagers: [],
        taskManagers: [],
        nextTaskId: 2,
      };

      mockProjects.push(projectA);
      mockProjectManagers.set('project-a', {
        id: 'project-a',
        name: 'my-app',
        path: '/path/to/my-app',
        listTasks: () => [task1],
      });

      await listCommand({ watch: true });

      const output = capturedOutput.join('\n');
      expect(output).toContain(
        'Watch mode is only supported when inside a project directory'
      );
    });
  });

  describe('JSON output', () => {
    beforeEach(() => {
      mockJsonMode = true;
    });

    afterEach(() => {
      mockJsonMode = false;
    });

    it('should include project field in JSON output for scoped mode', async () => {
      mockIsProjectMode.mockReturnValue(true);

      const task1 = createTestTask(1, 'JSON Task');

      mockResolveProjectContext.mockResolvedValue({
        id: 'test-project-id',
        path: testDir,
        repositoryName: 'test-repo',
        languages: [],
        packageManagers: [],
        taskManagers: [],
        listTasks: () => [task1],
      });

      await listCommand({ json: true });

      // Find the JSON output
      const jsonOutputLine = capturedOutput.find(line => {
        try {
          JSON.parse(line);
          return true;
        } catch {
          return false;
        }
      });

      expect(jsonOutputLine).toBeDefined();
      const parsed = JSON.parse(jsonOutputLine!);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].projectId).toBe('test-project-id');
    });

    it('should include project field in JSON output for global mode', async () => {
      mockIsProjectMode.mockReturnValue(false);
      mockResolveProjectContext.mockResolvedValue(null);

      const task1 = createTestTask(1, 'Global Task 1');
      const task2 = createTestTask(2, 'Global Task 2');

      const projectA: GlobalProject = {
        id: 'project-a',
        repositoryName: 'repo-a',
        path: '/path/a',
        languages: [],
        packageManagers: [],
        taskManagers: [],
        nextTaskId: 2,
      };

      const projectB: GlobalProject = {
        id: 'project-b',
        repositoryName: 'repo-b',
        path: '/path/b',
        languages: [],
        packageManagers: [],
        taskManagers: [],
        nextTaskId: 2,
      };

      mockProjects.push(projectA, projectB);

      mockProjectManagers.set('project-a', {
        id: 'project-a',
        name: 'repo-a',
        path: '/path/a',
        listTasks: () => [task1],
      });
      mockProjectManagers.set('project-b', {
        id: 'project-b',
        name: 'repo-b',
        path: '/path/b',
        listTasks: () => [task2],
      });

      await listCommand({ json: true });

      // Find the JSON output
      const jsonOutputLine = capturedOutput.find(line => {
        try {
          JSON.parse(line);
          return true;
        } catch {
          return false;
        }
      });

      expect(jsonOutputLine).toBeDefined();
      const parsed = JSON.parse(jsonOutputLine!);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(2);

      // Check first task has project info
      const taskFromA = parsed.find((t: any) => t.projectId === 'project-a');
      expect(taskFromA).toBeDefined();

      // Check second task has project info
      const taskFromB = parsed.find((t: any) => t.projectId === 'project-b');
      expect(taskFromB).toBeDefined();
    });

    it('should return empty array when no tasks in JSON mode', async () => {
      mockIsProjectMode.mockReturnValue(true);
      mockResolveProjectContext.mockResolvedValue({
        id: 'empty-project',
        path: testDir,
        repositoryName: 'empty-repo',
        languages: [],
        packageManagers: [],
        taskManagers: [],
        listTasks: () => [],
      });

      await listCommand({ json: true });

      const jsonOutputLine = capturedOutput.find(line => {
        try {
          JSON.parse(line);
          return true;
        } catch {
          return false;
        }
      });

      expect(jsonOutputLine).toBeDefined();
      const parsed = JSON.parse(jsonOutputLine!);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(0);
    });
  });
});
