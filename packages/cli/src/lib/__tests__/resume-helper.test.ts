import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock all external dependencies
vi.mock('rover-core', () => ({
  IterationManager: {
    createInitial: vi.fn(),
  },
  IterationStatusManager: {
    createInitial: vi.fn(),
  },
  Git: vi.fn().mockImplementation(() => ({
    createWorktree: vi.fn(),
    setupSparseCheckout: vi.fn(),
  })),
  ProjectConfigManager: {
    load: vi.fn().mockReturnValue({
      excludePatterns: [],
    }),
  },
}));

vi.mock('rover-schemas', () => ({
  TaskNotFoundError: class TaskNotFoundError extends Error {
    constructor(id: number) {
      super(`Task ${id} not found`);
      this.name = 'TaskNotFoundError';
    }
  },
}));

vi.mock('../sandbox/index.js', () => ({
  createSandbox: vi.fn(),
}));

vi.mock('../../utils/branch-name.js', () => ({
  generateBranchName: vi.fn().mockReturnValue('rover/task-1'),
}));

vi.mock('../../utils/env-files.js', () => ({
  copyEnvironmentFiles: vi.fn(),
}));

import { resumeTask } from '../resume-helper.js';
import { createSandbox } from '../sandbox/index.js';
import { TaskNotFoundError } from 'rover-schemas';
import { Git, IterationStatusManager } from 'rover-core';

const mockedCreateSandbox = vi.mocked(createSandbox);
const mockedGit = vi.mocked(Git);
const mockedIterationStatusManager = vi.mocked(IterationStatusManager);
let mockIterationStatus = {
  pause: vi.fn(),
  fail: vi.fn(),
};

function createMockTask(overrides: Record<string, any> = {}) {
  const merged: any = {
    id: 1,
    title: 'Test task',
    description: 'Test description',
    status: 'PAUSED',
    agent: 'claude',
    worktreePath: '/tmp/worktree',
    branchName: 'rover/task-1',
    sourceBranch: undefined,
    baseCommit: undefined,
    iterations: 1,
    iterationsPath: () => '/tmp/iterations',
    getLastIteration: () => null,
    markInProgress: vi.fn(),
    markPaused: vi.fn(),
    markFailed: vi.fn(),
    setAgentImage: vi.fn(),
    setWorkspace: vi.fn(),
    setContainerInfo: vi.fn(),
    ...overrides,
  };
  // Define status methods after spread so they aren't overwritten by overrides
  merged.isPaused = () => merged.status === 'PAUSED';
  merged.isFailed = () => merged.status === 'FAILED';
  return merged;
}

function createMockProject(task?: any) {
  return {
    path: '/tmp/project',
    getTask: vi.fn().mockReturnValue(task || null),
    getWorkspacePath: vi.fn().mockReturnValue('/tmp/workspace-1'),
  } as any;
}

describe('resumeTask', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateSandbox.mockReset();
    mockIterationStatus = {
      pause: vi.fn(),
      fail: vi.fn(),
    };
    mockedIterationStatusManager.createInitial.mockReturnValue(
      mockIterationStatus as any
    );
    tempDir = mkdtempSync(join(tmpdir(), 'rover-resume-helper-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns true on successful sandbox start', async () => {
    const task = createMockTask({ status: 'PAUSED' });
    const project = createMockProject(task);

    const mockSandbox = {
      createAndStart: vi.fn().mockResolvedValue('container-123'),
    };
    mockedCreateSandbox.mockResolvedValue(mockSandbox as any);

    const result = await resumeTask(project, 1);

    expect(result).toBe(true);
    expect(task.markInProgress).toHaveBeenCalled();
    expect(mockedIterationStatusManager.createInitial).toHaveBeenCalledWith(
      '/tmp/iterations/1/status.json',
      '1',
      'Resuming workflow'
    );
    expect(task.setContainerInfo).toHaveBeenCalledWith(
      'container-123',
      'running',
      undefined
    );
  });

  it('passes checkpoint.json to sandbox when resuming a paused iteration', async () => {
    const iterationPath = join(tempDir, 'iterations');
    const task = createMockTask({
      status: 'PAUSED',
      iterationsPath: () => iterationPath,
      iterations: 1,
    });
    const project = createMockProject(task);
    const checkpointPath = join(iterationPath, '1', 'checkpoint.json');
    mkdirSync(join(iterationPath, '1'), { recursive: true });
    writeFileSync(
      checkpointPath,
      '{"completedSteps":[{"id":"step1"}]}',
      'utf8'
    );

    const mockSandbox = {
      createAndStart: vi.fn().mockResolvedValue('container-with-checkpoint'),
    };
    mockedCreateSandbox.mockResolvedValue(mockSandbox as any);

    const result = await resumeTask(project, 1);

    expect(result).toBe(true);
    expect(mockedCreateSandbox).toHaveBeenCalledWith(task, undefined, {
      projectPath: project.path,
      checkpointPath,
    });
    expect(task.markInProgress).toHaveBeenCalled();
    expect(task.setContainerInfo).toHaveBeenCalledWith(
      'container-with-checkpoint',
      'running',
      undefined
    );
  });

  it('returns false for non-PAUSED/FAILED tasks', async () => {
    const task = createMockTask({ status: 'IN_PROGRESS' });
    const project = createMockProject(task);

    const result = await resumeTask(project, 1);

    expect(result).toBe(false);
    expect(task.markInProgress).not.toHaveBeenCalled();
  });

  it('returns false on sandbox creation failure', async () => {
    const task = createMockTask({ status: 'PAUSED' });
    const project = createMockProject(task);

    mockedCreateSandbox.mockResolvedValue({
      createAndStart: vi
        .fn()
        .mockRejectedValue(new Error('Docker not available')),
    } as any);

    const result = await resumeTask(project, 1);

    expect(result).toBe(false);
    expect(mockIterationStatus.pause).toHaveBeenCalledWith(
      'Resuming workflow',
      'Resume failed: container could not start'
    );
    expect(task.markPaused).toHaveBeenCalledWith(
      'Resume failed: container could not start'
    );
    expect(mockIterationStatus.fail).not.toHaveBeenCalled();
  });

  it('throws TaskNotFoundError for non-existent task', async () => {
    const project = createMockProject(null);

    await expect(resumeTask(project, 999)).rejects.toThrow(TaskNotFoundError);
  });

  it('works for FAILED tasks too', async () => {
    const task = createMockTask({ status: 'FAILED' });
    const project = createMockProject(task);

    const mockSandbox = {
      createAndStart: vi.fn().mockResolvedValue('container-456'),
    };
    mockedCreateSandbox.mockResolvedValue(mockSandbox as any);

    const result = await resumeTask(project, 1);

    expect(result).toBe(true);
    expect(task.markInProgress).toHaveBeenCalled();
  });

  it('restores FAILED status when container start fails during resume', async () => {
    const task = createMockTask({
      status: 'FAILED',
      error: 'Previous failure',
    });
    const project = createMockProject(task);

    mockedCreateSandbox.mockResolvedValue({
      createAndStart: vi
        .fn()
        .mockRejectedValue(new Error('Docker not available')),
    } as any);

    const result = await resumeTask(project, 1);

    expect(result).toBe(false);
    expect(task.markFailed).toHaveBeenCalledWith('Previous failure');
    expect(task.markPaused).not.toHaveBeenCalled();
    expect(mockIterationStatus.fail).toHaveBeenCalledWith(
      'Resuming workflow',
      'Resume failed: container could not start'
    );
    expect(mockIterationStatus.pause).not.toHaveBeenCalled();
  });

  it('clears stale dead-process resume locks and proceeds', async () => {
    const iterationPath = join(tempDir, 'iterations');
    const task = createMockTask({
      status: 'PAUSED',
      iterationsPath: () => iterationPath,
    });
    const project = createMockProject(task);

    const lockDir = join(iterationPath, '1');
    mkdirSync(lockDir, { recursive: true });
    const lockPath = join(lockDir, '.resume.lock');
    // Extremely large PID is not expected to exist; lock should be treated as stale.
    writeFileSync(lockPath, '99999999', 'utf8');

    mockedCreateSandbox.mockResolvedValue({
      createAndStart: vi.fn().mockResolvedValue('container-stale-lock'),
    } as any);

    const result = await resumeTask(project, 1);

    expect(result).toBe(true);
    expect(task.markInProgress).toHaveBeenCalled();
    expect(task.setContainerInfo).toHaveBeenCalledWith(
      'container-stale-lock',
      'running',
      undefined
    );
    expect(existsSync(lockPath)).toBe(false);
  });

  it('does not steal an old resume lock when owner process is still alive', async () => {
    const iterationPath = join(tempDir, 'iterations');
    const task = createMockTask({
      status: 'PAUSED',
      iterationsPath: () => iterationPath,
    });
    const project = createMockProject(task);

    const lockDir = join(iterationPath, '1');
    mkdirSync(lockDir, { recursive: true });
    const lockPath = join(lockDir, '.resume.lock');
    writeFileSync(lockPath, '424242', 'utf8');

    // Make the lock appear old; it should still be respected if owner is alive.
    const old = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(lockPath, old, old);

    const killSpy = vi
      .spyOn(process, 'kill')
      .mockImplementation((pid: number | bigint) => {
        if (pid === 424242) return true as any;
        throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
      });

    const result = await resumeTask(project, 1);

    expect(result).toBe(false);
    expect(mockedCreateSandbox).not.toHaveBeenCalled();
    expect(task.markInProgress).not.toHaveBeenCalled();
    expect(existsSync(lockPath)).toBe(true);

    killSpy.mockRestore();
  });

  it('does not bypass an existing lock owned by the current process', async () => {
    const iterationPath = join(tempDir, 'iterations');
    const task = createMockTask({
      status: 'PAUSED',
      iterationsPath: () => iterationPath,
    });
    const project = createMockProject(task);

    const lockDir = join(iterationPath, '1');
    mkdirSync(lockDir, { recursive: true });
    const lockPath = join(lockDir, '.resume.lock');
    writeFileSync(lockPath, String(process.pid), 'utf8');

    const result = await resumeTask(project, 1);

    expect(result).toBe(false);
    expect(mockedCreateSandbox).not.toHaveBeenCalled();
    expect(task.markInProgress).not.toHaveBeenCalled();
    expect(existsSync(lockPath)).toBe(true);
  });

  it('recreates a missing worktree even when task metadata is present', async () => {
    const missingWorktreePath = join(tempDir, 'missing-worktree');
    const task = createMockTask({
      status: 'PAUSED',
      worktreePath: missingWorktreePath,
      branchName: 'rover/task-1',
      sourceBranch: 'main',
    });
    const project = createMockProject(task);

    const mockSandbox = {
      createAndStart: vi.fn().mockResolvedValue('container-789'),
    };
    mockedCreateSandbox.mockResolvedValue(mockSandbox as any);

    const result = await resumeTask(project, 1);
    const gitInstance = mockedGit.mock.results.at(-1)?.value as {
      createWorktree: ReturnType<typeof vi.fn>;
    };

    expect(result).toBe(true);
    expect(project.getWorkspacePath).not.toHaveBeenCalled();
    expect(mockedGit).toHaveBeenCalledWith({ cwd: project.path });
    expect(gitInstance.createWorktree).toHaveBeenCalledWith(
      missingWorktreePath,
      'rover/task-1',
      'main'
    );
    expect(task.setWorkspace).toHaveBeenCalledWith(
      missingWorktreePath,
      'rover/task-1'
    );
  });

  it('prefers the stored base commit when recreating a missing worktree', async () => {
    const missingWorktreePath = join(tempDir, 'missing-worktree');
    const task = createMockTask({
      status: 'PAUSED',
      worktreePath: missingWorktreePath,
      branchName: 'rover/task-1',
      sourceBranch: 'main',
      baseCommit: 'abc123',
    });
    const project = createMockProject(task);

    mockedCreateSandbox.mockResolvedValue({
      createAndStart: vi.fn().mockResolvedValue('container-789'),
    } as any);

    const result = await resumeTask(project, 1);
    const gitInstance = mockedGit.mock.results.at(-1)?.value as {
      createWorktree: ReturnType<typeof vi.fn>;
    };

    expect(result).toBe(true);
    expect(gitInstance.createWorktree).toHaveBeenCalledWith(
      missingWorktreePath,
      'rover/task-1',
      'abc123'
    );
  });

  it('restores PAUSED status when worktree creation fails before sandbox start', async () => {
    const missingWorktreePath = join(tempDir, 'missing-worktree');
    const task = createMockTask({
      status: 'PAUSED',
      worktreePath: missingWorktreePath,
      error: 'Paused earlier',
      sourceBranch: 'main',
    });
    const project = createMockProject(task);

    mockedGit.mockImplementationOnce(
      () =>
        ({
          createWorktree: vi.fn().mockImplementation(() => {
            throw new Error('git worktree add failed');
          }),
          setupSparseCheckout: vi.fn(),
        }) as any
    );

    const result = await resumeTask(project, 1);

    expect(result).toBe(false);
    expect(task.markPaused).toHaveBeenCalledWith('Paused earlier');
  });

  it('marks task in progress before resetting status and storing container info', async () => {
    const callOrder: string[] = [];
    mockedIterationStatusManager.createInitial.mockImplementation(() => {
      callOrder.push('status');
      return {} as any;
    });
    const task = createMockTask({ status: 'PAUSED' });
    task.setContainerInfo.mockImplementation(() => {
      callOrder.push('container');
    });
    task.markInProgress.mockImplementation(() => {
      callOrder.push('task');
    });
    const project = createMockProject(task);

    mockedCreateSandbox.mockResolvedValue({
      createAndStart: vi.fn().mockResolvedValue('container-123'),
    } as any);

    const result = await resumeTask(project, 1);

    expect(result).toBe(true);
    expect(callOrder).toEqual(['task', 'status', 'container']);
  });
});
