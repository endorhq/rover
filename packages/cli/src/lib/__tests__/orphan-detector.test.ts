import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectOrphanedTasks } from '../orphan-detector.js';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => String(process.pid)),
  };
});

// Mock the sandbox module
vi.mock('../sandbox/index.js', () => ({
  createSandbox: vi.fn(),
}));

// isResumeLockActive uses node:fs internally, so the fs mock above controls
// its behavior. No separate mock needed — just import to verify calls.

import { createSandbox } from '../sandbox/index.js';
import { existsSync, readFileSync } from 'node:fs';

const mockedCreateSandbox = vi.mocked(createSandbox);
const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

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
    updateStatusFromIteration: vi.fn(),
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
    vi.restoreAllMocks();
    mockedCreateSandbox.mockReset();
    mockedExistsSync.mockReset();
    mockedReadFileSync.mockReset();
    mockedExistsSync.mockReturnValue(false);
    mockedReadFileSync.mockReturnValue(String(process.pid));
    vi.spyOn(process, 'kill').mockImplementation(() => true);
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

  it('does not mark IN_PROGRESS task when container is restarting', async () => {
    const task = mockTask(30, 'IN_PROGRESS', 'container-30');
    const sandbox = {
      inspect: vi.fn().mockResolvedValue({ status: 'restarting' }),
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
    const now = Date.now();
    const task = mockTask(21, 'IN_PROGRESS', 'container-21', {
      // lastRestartAt is recent (10 seconds ago), runningAt is before it
      lastRestartAt: new Date(now - 10_000).toISOString(),
      runningAt: new Date(now - 20_000).toISOString(),
    });

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(mockedCreateSandbox).not.toHaveBeenCalled();
    expect(task.markFailed).not.toHaveBeenCalled();
  });

  it('inspects task after restart startup is confirmed running', async () => {
    const now = Date.now();
    const task = mockTask(22, 'IN_PROGRESS', 'container-22', {
      // runningAt is AFTER lastRestartAt → startup completed, proceed with inspection
      lastRestartAt: new Date(now - 20_000).toISOString(),
      runningAt: new Date(now - 10_000).toISOString(),
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
    mockedReadFileSync.mockReturnValue('424242');
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === 424242 && signal === 0) {
        return true;
      }
      throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
    });

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(mockedCreateSandbox).not.toHaveBeenCalled();
    expect(task.markFailed).not.toHaveBeenCalled();
  });

  it('reads iteration status before marking FAILED for exit code 1', async () => {
    const task = mockTask(27, 'IN_PROGRESS', 'container-27', {
      updateStatusFromIteration: vi.fn(() => {
        // Simulate the agent having written a meaningful error to status.json
        task.status = 'FAILED';
      }),
    });
    const sandbox = {
      inspect: vi.fn().mockResolvedValue({ status: 'exited', exitCode: 1 }),
    };
    mockedCreateSandbox.mockResolvedValue(sandbox as any);

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(task.updateStatusFromIteration).toHaveBeenCalledTimes(1);
    // Should NOT call markFailed again since updateStatusFromIteration already set FAILED
    expect(task.markFailed).not.toHaveBeenCalled();
  });

  it('falls back to generic message for exit code 1 when status file has no error', async () => {
    const task = mockTask(28, 'IN_PROGRESS', 'container-28', {
      updateStatusFromIteration: vi.fn(),
    });
    const sandbox = {
      inspect: vi.fn().mockResolvedValue({ status: 'exited', exitCode: 1 }),
    };
    mockedCreateSandbox.mockResolvedValue(sandbox as any);

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(task.updateStatusFromIteration).toHaveBeenCalledTimes(1);
    expect(task.markFailed).toHaveBeenCalledWith(
      'Container exited unexpectedly (possible crash or system restart)'
    );
  });

  it('detects orphan when restart startup has timed out (>5 minutes)', async () => {
    const task = mockTask(29, 'IN_PROGRESS', 'container-29', {
      // lastRestartAt was over 5 minutes ago but runningAt was never updated
      lastRestartAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
      runningAt: undefined,
    });
    const sandbox = { inspect: vi.fn().mockResolvedValue(null) };
    mockedCreateSandbox.mockResolvedValue(sandbox as any);

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    // After the 5-minute timeout, the task should no longer be considered "in flight"
    expect(mockedCreateSandbox).toHaveBeenCalledTimes(1);
    expect(task.markFailed).toHaveBeenCalledWith(
      'Container exited unexpectedly (possible crash or system restart)'
    );
  });

  it('skips orphan detection when restart startup is recent (<5 minutes) without runningAt', async () => {
    const task = mockTask(30, 'IN_PROGRESS', 'container-30', {
      // lastRestartAt was 1 minute ago, runningAt never updated
      lastRestartAt: new Date(Date.now() - 60 * 1000).toISOString(),
      runningAt: undefined,
    });

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(mockedCreateSandbox).not.toHaveBeenCalled();
    expect(task.markFailed).not.toHaveBeenCalled();
  });

  it('does not treat stale resume lock as active and continues orphan detection', async () => {
    const task = mockTask(26, 'IN_PROGRESS', 'container-26');
    const sandbox = { inspect: vi.fn().mockResolvedValue(null) };
    mockedCreateSandbox.mockResolvedValue(sandbox as any);
    mockedExistsSync.mockImplementation(path =>
      String(path).endsWith('.resume.lock')
    );
    mockedReadFileSync.mockReturnValue('99999999');
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
    });

    await detectOrphanedTasks([{ task, project: mockProject() }]);

    expect(mockedCreateSandbox).toHaveBeenCalledTimes(1);
    expect(task.markFailed).toHaveBeenCalledWith(
      'Container exited unexpectedly (possible crash or system restart)'
    );
  });
});
