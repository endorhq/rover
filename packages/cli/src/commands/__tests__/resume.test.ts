import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockExitWithError,
  mockExitWithSuccess,
  mockResumeTask,
  mockRequireProjectContext,
  mockGetTelemetry,
} = vi.hoisted(() => ({
  mockExitWithError: vi.fn(),
  mockExitWithSuccess: vi.fn(),
  mockResumeTask: vi.fn(),
  mockRequireProjectContext: vi.fn(),
  mockGetTelemetry: vi.fn(),
}));

let mockJsonMode = false;

vi.mock('../../utils/exit.js', () => ({
  exitWithError: mockExitWithError,
  exitWithSuccess: mockExitWithSuccess,
}));

vi.mock('../../lib/resume-helper.js', () => ({
  resumeTask: mockResumeTask,
}));

vi.mock('../../lib/telemetry.js', () => ({
  getTelemetry: mockGetTelemetry,
}));

vi.mock('../../lib/context.js', () => ({
  isJsonMode: () => mockJsonMode,
  setJsonMode: (value: boolean) => {
    mockJsonMode = value;
  },
  requireProjectContext: mockRequireProjectContext,
}));

import { resumeCommand } from '../resume.js';

describe('resume command', () => {
  beforeEach(() => {
    mockJsonMode = false;
    vi.clearAllMocks();
    mockGetTelemetry.mockReturnValue({
      eventResumeTask: vi.fn(),
      eventResumeTaskFailed: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
    });
    mockResumeTask.mockResolvedValue({ status: 'ok' });
    mockExitWithError.mockResolvedValue(undefined);
    mockExitWithSuccess.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes task status from the latest iteration before validating resume eligibility', async () => {
    const task = {
      id: 7,
      title: 'Paused task',
      description: 'desc',
      status: 'IN_PROGRESS',
      iterations: 1,
      branchName: 'rover/task-7',
      worktreePath: '/tmp/worktree-7',
      iterationsPath: () => '/tmp/task-7/iterations',
      updateStatusFromIteration: vi.fn(function (this: any) {
        this.status = 'PAUSED';
      }),
      isPaused: vi.fn(function (this: any) {
        return this.status === 'PAUSED';
      }),
      isFailed: vi.fn(function (this: any) {
        return this.status === 'FAILED';
      }),
    };
    const project = {
      getTask: vi.fn().mockReturnValue(task),
    };

    mockRequireProjectContext.mockResolvedValue(project);

    await resumeCommand('7', { json: true });

    expect(task.updateStatusFromIteration).toHaveBeenCalledTimes(1);
    expect(mockResumeTask).toHaveBeenCalledWith(project, 7);
    expect(mockExitWithError).not.toHaveBeenCalled();
    expect(mockExitWithSuccess).toHaveBeenCalledTimes(1);
  });

  it('preserves FAILED status and skips iteration status refresh when resuming', async () => {
    const task = {
      id: 8,
      title: 'Failed task',
      description: 'desc',
      status: 'FAILED',
      iterations: 1,
      branchName: 'rover/task-8',
      worktreePath: '/tmp/worktree-8',
      iterationsPath: () => '/tmp/task-8/iterations',
      updateStatusFromIteration: vi.fn(function (this: any) {
        this.status = 'ITERATING';
      }),
      isPaused: vi.fn(function (this: any) {
        return this.status === 'PAUSED';
      }),
      isFailed: vi.fn(function (this: any) {
        return this.status === 'FAILED';
      }),
    };
    const project = {
      getTask: vi.fn().mockReturnValue(task),
    };

    mockRequireProjectContext.mockResolvedValue(project);

    await resumeCommand('8', { json: true });

    expect(task.updateStatusFromIteration).not.toHaveBeenCalled();
    expect(mockResumeTask).toHaveBeenCalledWith(project, 8);
    expect(mockExitWithError).not.toHaveBeenCalled();
    expect(mockExitWithSuccess).toHaveBeenCalledTimes(1);
  });

  it('rejects non-numeric task ID', async () => {
    await resumeCommand('abc', { json: true });

    expect(mockExitWithError).toHaveBeenCalledTimes(1);
    expect(mockExitWithError).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: "Invalid task ID 'abc' - must be a number",
      }),
      expect.objectContaining({ telemetry: expect.anything() })
    );
    expect(mockResumeTask).not.toHaveBeenCalled();
  });

  it('rejects task that is neither PAUSED nor FAILED', async () => {
    const task = {
      id: 10,
      title: 'Completed task',
      description: 'desc',
      status: 'COMPLETED',
      iterations: 1,
      branchName: 'rover/task-10',
      worktreePath: '/tmp/worktree-10',
      iterationsPath: () => '/tmp/task-10/iterations',
      updateStatusFromIteration: vi.fn(),
      isPaused: vi.fn(function (this: any) {
        return this.status === 'PAUSED';
      }),
      isFailed: vi.fn(function (this: any) {
        return this.status === 'FAILED';
      }),
    };
    const project = {
      getTask: vi.fn().mockReturnValue(task),
    };

    mockRequireProjectContext.mockResolvedValue(project);

    await resumeCommand('10', { json: true });

    expect(mockExitWithError).toHaveBeenCalledTimes(1);
    expect(mockExitWithError).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'Task 10 is not in PAUSED or FAILED status (current: COMPLETED)',
      }),
      expect.objectContaining({ telemetry: expect.anything() })
    );
    expect(mockResumeTask).not.toHaveBeenCalled();
  });

  it('handles TaskNotFoundError when task does not exist', async () => {
    const project = {
      getTask: vi.fn().mockReturnValue(null),
    };

    mockRequireProjectContext.mockResolvedValue(project);

    await resumeCommand('99', { json: true });

    expect(mockExitWithError).toHaveBeenCalledTimes(1);
    expect(mockExitWithError).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'The task with ID 99 was not found',
      }),
      expect.objectContaining({ telemetry: expect.anything() })
    );
    expect(mockResumeTask).not.toHaveBeenCalled();
  });

  it('handles resumeTask returning failed status', async () => {
    const task = {
      id: 11,
      title: 'Paused task',
      description: 'desc',
      status: 'PAUSED',
      iterations: 1,
      branchName: 'rover/task-11',
      worktreePath: '/tmp/worktree-11',
      iterationsPath: () => '/tmp/task-11/iterations',
      updateStatusFromIteration: vi.fn(),
      isPaused: vi.fn(function (this: any) {
        return this.status === 'PAUSED';
      }),
      isFailed: vi.fn(function (this: any) {
        return this.status === 'FAILED';
      }),
    };
    const project = {
      getTask: vi.fn().mockReturnValue(task),
    };

    mockRequireProjectContext.mockResolvedValue(project);
    mockResumeTask.mockResolvedValue({
      status: 'failed',
      error: 'Docker not available',
    });

    await resumeCommand('11', { json: true });

    expect(mockResumeTask).toHaveBeenCalledWith(project, 11);
    expect(mockExitWithError).toHaveBeenCalledTimes(1);
    expect(mockExitWithError).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'Failed to resume task 11: Docker not available',
      }),
      expect.objectContaining({ telemetry: expect.anything() })
    );
    expect(mockExitWithSuccess).not.toHaveBeenCalled();
  });

  it('handles resumeTask returning already_resuming status', async () => {
    const task = {
      id: 13,
      title: 'Paused task',
      description: 'desc',
      status: 'PAUSED',
      iterations: 1,
      branchName: 'rover/task-13',
      worktreePath: '/tmp/worktree-13',
      iterationsPath: () => '/tmp/task-13/iterations',
      updateStatusFromIteration: vi.fn(),
      isPaused: vi.fn(function (this: any) {
        return this.status === 'PAUSED';
      }),
      isFailed: vi.fn(function (this: any) {
        return this.status === 'FAILED';
      }),
    };
    const project = {
      getTask: vi.fn().mockReturnValue(task),
    };

    mockRequireProjectContext.mockResolvedValue(project);
    mockResumeTask.mockResolvedValue({ status: 'already_resuming' });

    await resumeCommand('13', { json: true });

    expect(mockResumeTask).toHaveBeenCalledWith(project, 13);
    expect(mockExitWithError).toHaveBeenCalledTimes(1);
    expect(mockExitWithError).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('already being resumed'),
      }),
      expect.objectContaining({ telemetry: expect.anything() })
    );
    expect(mockExitWithSuccess).not.toHaveBeenCalled();
  });

  it('handles project context failure', async () => {
    mockRequireProjectContext.mockRejectedValue(
      new Error('Not in a rover project')
    );

    await resumeCommand('5', { json: true });

    expect(mockExitWithError).toHaveBeenCalledTimes(1);
    expect(mockExitWithError).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'Not in a rover project',
      }),
      expect.objectContaining({ telemetry: expect.anything() })
    );
    expect(mockResumeTask).not.toHaveBeenCalled();
  });

  it('sets json mode when --json option is passed', async () => {
    const task = {
      id: 12,
      title: 'Paused task',
      description: 'desc',
      status: 'PAUSED',
      iterations: 1,
      branchName: 'rover/task-12',
      worktreePath: '/tmp/worktree-12',
      iterationsPath: () => '/tmp/task-12/iterations',
      updateStatusFromIteration: vi.fn(),
      isPaused: vi.fn(function (this: any) {
        return this.status === 'PAUSED';
      }),
      isFailed: vi.fn(function (this: any) {
        return this.status === 'FAILED';
      }),
    };
    const project = {
      getTask: vi.fn().mockReturnValue(task),
    };

    mockRequireProjectContext.mockResolvedValue(project);

    expect(mockJsonMode).toBe(false);

    await resumeCommand('12', { json: true });

    expect(mockJsonMode).toBe(true);
  });
});
