import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectOrphanedTasks } from '../orphan-detector.js';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
  };
});

// Mock the sandbox module
vi.mock('../sandbox/index.js', () => ({
  createSandbox: vi.fn(),
}));

import { createSandbox } from '../sandbox/index.js';
import { existsSync } from 'node:fs';

const mockedCreateSandbox = vi.mocked(createSandbox);
const mockedExistsSync = vi.mocked(existsSync);

/**
 * Helper to build a minimal mock task with the given status.
 */
function mockTask(
  id: number,
  status: string,
  containerId?: string,
  overrides: Record<string, unknown> = {}
) {
  const task: Record<string, unknown> = {
    id,
    status,
    containerId,
    iterations: 1,
    iterationsPath: () => `/projects/test/.rover/tasks/${id}`,
    markFailed: vi.fn(),
    markCompleted: vi.fn(),
    markPaused: vi.fn(),
    lastRestartAt: undefined,
    runningAt: undefined,
  };
  Object.assign(task, overrides);
  task.isInProgress = () => task.status === 'IN_PROGRESS';
  task.isIterating = () => task.status === 'ITERATING';
  task.isCompleted = () => task.status === 'COMPLETED';
  task.isFailed = () => task.status === 'FAILED';
  task.isPaused = () => task.status === 'PAUSED';
  return task as any;
}

function mockProject(path = '/projects/test') {
  return { path } as any;
}

describe('detectOrphanedTasks', () => {
  beforeEach(() => {
    mockedCreateSandbox.mockReset();
    mockedExistsSync.mockReset();
    mockedExistsSync.mockReturnValue(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('marks IN_PROGRESS task as FAILED when container exited', async () => {
    const task = mockTask(1, 'IN_PROGRESS', 'container-1');
    const sandbox = {
      inspect: vi.fn().mockResolvedValue({ status: 'exited' }),
    };
    mockedCreateSandbox.mockResolvedValue(sandbox as any);

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(task.markFailed).toHaveBeenCalledWith(
      'Container exited unexpectedly (possible crash or system restart)'
    );
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('does not inspect or fail IN_PROGRESS task when container id is not known yet', async () => {
    const task = mockTask(2, 'IN_PROGRESS');

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(mockedCreateSandbox).not.toHaveBeenCalled();
    expect(task.markFailed).not.toHaveBeenCalled();
  });

  it('does not fail slow startup tasks without a container id based on elapsed time', async () => {
    const task = {
      ...mockTask(20, 'IN_PROGRESS'),
      startedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    };

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(mockedCreateSandbox).not.toHaveBeenCalled();
    expect(task.markFailed).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('marks IN_PROGRESS task as FAILED when a known container is gone', async () => {
    const task = mockTask(15, 'IN_PROGRESS', 'container-15');
    const sandbox = { inspect: vi.fn().mockResolvedValue(null) };
    mockedCreateSandbox.mockResolvedValue(sandbox as any);

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(task.markFailed).toHaveBeenCalledWith(
      'Container exited unexpectedly (possible crash or system restart)'
    );
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('does not mark task as FAILED when container inspect errors', async () => {
    const task = mockTask(19, 'IN_PROGRESS', 'container-19');
    const sandbox = {
      inspect: vi
        .fn()
        .mockRejectedValue(new Error('Cannot connect to container backend')),
    };
    mockedCreateSandbox.mockResolvedValue(sandbox as any);

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(task.markFailed).not.toHaveBeenCalled();
    // A warning is logged so operators can investigate backend issues
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Cannot connect to container backend')
    );
  });

  it('suppresses warnings when suppressWarnings option is enabled', async () => {
    const task = mockTask(17, 'IN_PROGRESS', 'container-17');
    const sandbox = { inspect: vi.fn().mockResolvedValue(null) };
    mockedCreateSandbox.mockResolvedValue(sandbox as any);

    await detectOrphanedTasks([{ task, project: mockProject() }], {
      suppressWarnings: true,
    });

    expect(task.markFailed).toHaveBeenCalledWith(
      'Container exited unexpectedly (possible crash or system restart)'
    );
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('does not mark IN_PROGRESS task when container is running', async () => {
    const task = mockTask(3, 'IN_PROGRESS', 'container-3');
    const sandbox = {
      inspect: vi.fn().mockResolvedValue({ status: 'running' }),
    };
    mockedCreateSandbox.mockResolvedValue(sandbox as any);

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(task.markFailed).not.toHaveBeenCalled();
  });

  it('marks ITERATING task as FAILED when container is dead', async () => {
    const task = mockTask(4, 'ITERATING', 'container-4');
    const sandbox = {
      inspect: vi.fn().mockResolvedValue({ status: 'exited' }),
    };
    mockedCreateSandbox.mockResolvedValue(sandbox as any);

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(task.markFailed).toHaveBeenCalledWith(
      'Container exited unexpectedly (possible crash or system restart)'
    );
  });

  it('skips PAUSED, FAILED, COMPLETED, and NEW tasks', async () => {
    const tasks = [
      { task: mockTask(5, 'PAUSED'), project: mockProject() },
      { task: mockTask(6, 'FAILED'), project: mockProject() },
      { task: mockTask(7, 'COMPLETED'), project: mockProject() },
      { task: mockTask(8, 'NEW'), project: mockProject() },
    ];

    await detectOrphanedTasks(tasks);

    // createSandbox should never be called for non-active statuses
    expect(mockedCreateSandbox).not.toHaveBeenCalled();
    for (const { task } of tasks) {
      expect(task.markFailed).not.toHaveBeenCalled();
    }
  });

  it('skips gracefully when sandbox backend is unavailable', async () => {
    const task = mockTask(9, 'IN_PROGRESS');
    mockedCreateSandbox.mockRejectedValue(new Error('No Docker or Podman'));

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(task.markFailed).not.toHaveBeenCalled();
  });

  it('handles mix of orphaned and running tasks', async () => {
    const orphanedTask = mockTask(10, 'IN_PROGRESS', 'container-10');
    const runningTask = mockTask(11, 'ITERATING', 'container-11');
    const pausedTask = mockTask(12, 'PAUSED');

    mockedCreateSandbox
      .mockResolvedValueOnce({
        inspect: vi.fn().mockResolvedValue(null),
      } as any)
      .mockResolvedValueOnce({
        inspect: vi.fn().mockResolvedValue({ status: 'running' }),
      } as any);

    await detectOrphanedTasks([
      { task: orphanedTask, project: mockProject() },
      { task: runningTask, project: mockProject() },
      { task: pausedTask, project: mockProject() },
    ]);

    expect(orphanedTask.markFailed).toHaveBeenCalled();
    expect(runningTask.markFailed).not.toHaveBeenCalled();
    expect(pausedTask.markFailed).not.toHaveBeenCalled();
  });

  it('skips task when project is null', async () => {
    const task = mockTask(13, 'IN_PROGRESS');

    await detectOrphanedTasks([{ task, project: null }]);

    expect(mockedCreateSandbox).not.toHaveBeenCalled();
    expect(task.markFailed).not.toHaveBeenCalled();
  });

  it('includes error details in warning when sandbox fails', async () => {
    const task = mockTask(14, 'IN_PROGRESS', 'container-14');
    mockedCreateSandbox.mockRejectedValue(
      new Error('Docker daemon not running')
    );

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(task.markFailed).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Docker daemon not running')
    );
  });

  it('does not mark task as failed while known container is still starting', async () => {
    const task = mockTask(16, 'IN_PROGRESS', 'container-16');
    const sandbox = {
      inspect: vi.fn().mockResolvedValue({ status: 'created' }),
    };
    mockedCreateSandbox.mockResolvedValue(sandbox as any);

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(task.markFailed).not.toHaveBeenCalled();
  });

  it('marks task as COMPLETED when container exited cleanly but task remains ITERATING after refresh', async () => {
    const task = mockTask(23, 'ITERATING', 'container-23', {
      updateStatusFromIteration: vi.fn(),
    });
    const sandbox = {
      inspect: vi.fn().mockResolvedValue({ status: 'exited', exitCode: 0 }),
    };
    mockedCreateSandbox.mockResolvedValue(sandbox as any);

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(task.updateStatusFromIteration).toHaveBeenCalledTimes(1);
    expect(task.markCompleted).toHaveBeenCalledTimes(1);
    expect(task.markFailed).not.toHaveBeenCalled();
  });

  it('skips orphan detection while restart startup is still in flight', async () => {
    const task = mockTask(21, 'IN_PROGRESS', 'container-21', {
      lastRestartAt: '2026-02-20T12:00:10.000Z',
      runningAt: '2026-02-20T12:00:00.000Z',
    });

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(mockedCreateSandbox).not.toHaveBeenCalled();
    expect(task.markFailed).not.toHaveBeenCalled();
  });

  it('inspects task after restart startup is confirmed running', async () => {
    const task = mockTask(22, 'IN_PROGRESS', 'container-22', {
      lastRestartAt: '2026-02-20T12:00:00.000Z',
      runningAt: '2026-02-20T12:00:10.000Z',
    });
    const sandbox = { inspect: vi.fn().mockResolvedValue(null) };
    mockedCreateSandbox.mockResolvedValue(sandbox as any);

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(mockedCreateSandbox).toHaveBeenCalledTimes(1);
    expect(task.markFailed).toHaveBeenCalledWith(
      'Container exited unexpectedly (possible crash or system restart)'
    );
  });

  it('marks task as PAUSED when container exited with PAUSED exit code and status file not written', async () => {
    const task = mockTask(24, 'IN_PROGRESS', 'container-24', {
      updateStatusFromIteration: vi.fn(),
    });
    const sandbox = {
      inspect: vi.fn().mockResolvedValue({ status: 'exited', exitCode: 2 }),
    };
    mockedCreateSandbox.mockResolvedValue(sandbox as any);

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(task.updateStatusFromIteration).toHaveBeenCalledTimes(1);
    expect(task.markPaused).toHaveBeenCalledWith(
      'Workflow paused due to retryable error (e.g. credit limit)'
    );
    expect(task.markFailed).not.toHaveBeenCalled();
    expect(task.markCompleted).not.toHaveBeenCalled();
  });

  it('does not call markPaused when updateStatusFromIteration already set PAUSED', async () => {
    const task = mockTask(25, 'IN_PROGRESS', 'container-25', {
      updateStatusFromIteration: vi.fn(() => {
        task.status = 'PAUSED';
      }),
    });
    const sandbox = {
      inspect: vi.fn().mockResolvedValue({ status: 'exited', exitCode: 2 }),
    };
    mockedCreateSandbox.mockResolvedValue(sandbox as any);

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(task.updateStatusFromIteration).toHaveBeenCalledTimes(1);
    expect(task.markPaused).not.toHaveBeenCalled();
    expect(task.markFailed).not.toHaveBeenCalled();
  });

  it('skips orphan detection while resume lock is active for known container', async () => {
    const task = mockTask(18, 'IN_PROGRESS', 'container-18');
    mockedExistsSync.mockImplementation(path =>
      String(path).endsWith('.resume.lock')
    );

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(mockedCreateSandbox).not.toHaveBeenCalled();
    expect(task.markFailed).not.toHaveBeenCalled();
  });
});
