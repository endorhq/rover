import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as context from '../context.js';

// Mock rover-core with importActual pattern
vi.mock('rover-core', async () => {
  const actual = await vi.importActual('rover-core');
  return {
    ...actual,
    launchSync: vi.fn(),
  };
});

// Mock context
vi.mock('../context.js', () => ({
  isJsonMode: vi.fn(() => false),
}));

import { launchSync } from 'rover-core';
// Import hooks after mocks are set up
import { executeHook, executeHooks, HookContext } from '../hooks.js';

const mockedLaunchSync = vi.mocked(launchSync);
const mockedIsJsonMode = vi.mocked(context.isJsonMode);

describe('hooks library', () => {
  const defaultContext: HookContext = {
    taskId: 42,
    taskBranch: 'task/42-add-feature',
    taskTitle: 'Add new feature',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedIsJsonMode.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('executeHook()', () => {
    it('should execute a command successfully', () => {
      mockedLaunchSync.mockReturnValue({
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        command: 'sh',
        escapedCommand: 'sh -c "echo hello"',
        failed: false,
        timedOut: false,
        killed: false,
      } as any);

      const result = executeHook('echo hello', defaultContext);

      expect(result.success).toBe(true);
      expect(result.command).toBe('echo hello');
      expect(result.warning).toBeUndefined();
    });

    it('should pass environment variables with ROVER_ prefix', () => {
      mockedLaunchSync.mockReturnValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        command: 'sh',
        escapedCommand: 'sh -c "env"',
        failed: false,
        timedOut: false,
        killed: false,
      } as any);

      executeHook('env', defaultContext);

      expect(mockedLaunchSync).toHaveBeenCalledWith(
        'sh',
        ['-c', 'env'],
        expect.objectContaining({
          env: expect.objectContaining({
            ROVER_TASK_ID: '42',
            ROVER_TASK_BRANCH: 'task/42-add-feature',
            ROVER_TASK_TITLE: 'Add new feature',
          }),
          stdio: 'pipe',
        })
      );
    });

    it('should return failure result when command throws', () => {
      mockedLaunchSync.mockImplementation(() => {
        throw new Error('Command not found: invalid-command');
      });

      const result = executeHook('invalid-command', defaultContext);

      expect(result.success).toBe(false);
      expect(result.command).toBe('invalid-command');
      expect(result.warning).toContain('Hook command failed');
      expect(result.warning).toContain('invalid-command');
      expect(result.warning).toContain('Command not found');
    });

    it('should return failure result when command exits with non-zero code', () => {
      mockedLaunchSync.mockImplementation(() => {
        throw new Error('Command failed with exit code 1');
      });

      const result = executeHook('exit 1', defaultContext);

      expect(result.success).toBe(false);
      expect(result.command).toBe('exit 1');
      expect(result.warning).toContain('Hook command failed');
      expect(result.warning).toContain('exit code 1');
    });

    it('should handle non-Error exceptions', () => {
      mockedLaunchSync.mockImplementation(() => {
        throw 'string error';
      });

      const result = executeHook('throw-string', defaultContext);

      expect(result.success).toBe(false);
      expect(result.warning).toContain('string error');
    });

    it('should preserve existing process.env variables', () => {
      const originalEnv = process.env.PATH;
      mockedLaunchSync.mockReturnValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        command: 'sh',
        escapedCommand: 'sh -c "test"',
        failed: false,
        timedOut: false,
        killed: false,
      } as any);

      executeHook('test', defaultContext);

      expect(mockedLaunchSync).toHaveBeenCalledWith(
        'sh',
        ['-c', 'test'],
        expect.objectContaining({
          env: expect.objectContaining({
            PATH: originalEnv,
          }),
        })
      );
    });
  });

  describe('executeHooks()', () => {
    it('should execute multiple commands sequentially', () => {
      mockedLaunchSync.mockReturnValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        command: 'sh',
        escapedCommand: 'sh -c "echo"',
        failed: false,
        timedOut: false,
        killed: false,
      } as any);

      const commands = ['echo first', 'echo second', 'echo third'];
      const results = executeHooks(commands, defaultContext, 'onMerge');

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);
      expect(mockedLaunchSync).toHaveBeenCalledTimes(3);
    });

    it('should return empty array for empty commands', () => {
      const results = executeHooks([], defaultContext, 'onMerge');

      expect(results).toHaveLength(0);
      expect(mockedLaunchSync).not.toHaveBeenCalled();
    });

    it('should continue executing hooks after failure', () => {
      mockedLaunchSync
        .mockReturnValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          command: 'sh',
          escapedCommand: 'sh -c "echo first"',
          failed: false,
          timedOut: false,
          killed: false,
        } as any)
        .mockImplementationOnce(() => {
          throw new Error('Second command failed');
        })
        .mockReturnValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          command: 'sh',
          escapedCommand: 'sh -c "echo third"',
          failed: false,
          timedOut: false,
          killed: false,
        } as any);

      const commands = ['echo first', 'failing-command', 'echo third'];
      const results = executeHooks(commands, defaultContext, 'onPush');

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
      expect(mockedLaunchSync).toHaveBeenCalledTimes(3);
    });

    it('should log warnings for failed hooks in non-JSON mode', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockedIsJsonMode.mockReturnValue(false);
      mockedLaunchSync.mockImplementation(() => {
        throw new Error('Hook failed');
      });

      executeHooks(['failing-command'], defaultContext, 'onMerge');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('onMerge hook warning')
      );
      consoleSpy.mockRestore();
    });

    it('should not log warnings for failed hooks in JSON mode', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockedIsJsonMode.mockReturnValue(true);
      mockedLaunchSync.mockImplementation(() => {
        throw new Error('Hook failed');
      });

      executeHooks(['failing-command'], defaultContext, 'onMerge');

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle mixed success and failure results', () => {
      mockedLaunchSync
        .mockReturnValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          command: 'sh',
          escapedCommand: 'sh -c "echo success1"',
          failed: false,
          timedOut: false,
          killed: false,
        } as any)
        .mockImplementationOnce(() => {
          throw new Error('Failure 1');
        })
        .mockReturnValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          command: 'sh',
          escapedCommand: 'sh -c "echo success2"',
          failed: false,
          timedOut: false,
          killed: false,
        } as any)
        .mockImplementationOnce(() => {
          throw new Error('Failure 2');
        });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const commands = ['success1', 'fail1', 'success2', 'fail2'];
      const results = executeHooks(commands, defaultContext, 'onPush');

      expect(results).toHaveLength(4);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[2].success).toBe(true);
      expect(results[3].success).toBe(false);

      // Should log warnings for both failures
      expect(consoleSpy).toHaveBeenCalledTimes(2);
      consoleSpy.mockRestore();
    });

    it('should pass correct hook type in warning messages', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockedLaunchSync.mockImplementation(() => {
        throw new Error('Hook failed');
      });

      executeHooks(['failing-command'], defaultContext, 'onMerge');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('onMerge')
      );

      consoleSpy.mockClear();

      executeHooks(['failing-command'], defaultContext, 'onPush');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('onPush')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('HookContext interface', () => {
    it('should support numeric task IDs', () => {
      mockedLaunchSync.mockReturnValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        command: 'sh',
        escapedCommand: 'sh -c "test"',
        failed: false,
        timedOut: false,
        killed: false,
      } as any);

      const context: HookContext = {
        taskId: 12345,
        taskBranch: 'task/12345-big-task',
        taskTitle: 'A big task',
      };

      executeHook('test', context);

      expect(mockedLaunchSync).toHaveBeenCalledWith(
        'sh',
        ['-c', 'test'],
        expect.objectContaining({
          env: expect.objectContaining({
            ROVER_TASK_ID: '12345',
          }),
        })
      );
    });

    it('should handle special characters in task title', () => {
      mockedLaunchSync.mockReturnValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        command: 'sh',
        escapedCommand: 'sh -c "test"',
        failed: false,
        timedOut: false,
        killed: false,
      } as any);

      const context: HookContext = {
        taskId: 1,
        taskBranch: 'task/1-special',
        taskTitle: 'Fix "bug" with $special chars & more',
      };

      executeHook('test', context);

      expect(mockedLaunchSync).toHaveBeenCalledWith(
        'sh',
        ['-c', 'test'],
        expect.objectContaining({
          env: expect.objectContaining({
            ROVER_TASK_TITLE: 'Fix "bug" with $special chars & more',
          }),
        })
      );
    });

    it('should pass ROVER_TASK_STATUS when taskStatus is provided', () => {
      mockedLaunchSync.mockReturnValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        command: 'sh',
        escapedCommand: 'sh -c "test"',
        failed: false,
        timedOut: false,
        killed: false,
      } as any);

      const context: HookContext = {
        taskId: 42,
        taskBranch: 'task/42-done',
        taskTitle: 'Completed task',
        taskStatus: 'completed',
      };

      executeHook('echo done', context);

      expect(mockedLaunchSync).toHaveBeenCalledWith(
        'sh',
        ['-c', 'echo done'],
        expect.objectContaining({
          env: expect.objectContaining({
            ROVER_TASK_ID: '42',
            ROVER_TASK_BRANCH: 'task/42-done',
            ROVER_TASK_TITLE: 'Completed task',
            ROVER_TASK_STATUS: 'completed',
          }),
        })
      );
    });

    it('should pass ROVER_TASK_STATUS as failed for failed tasks', () => {
      mockedLaunchSync.mockReturnValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        command: 'sh',
        escapedCommand: 'sh -c "test"',
        failed: false,
        timedOut: false,
        killed: false,
      } as any);

      const context: HookContext = {
        taskId: 43,
        taskBranch: 'task/43-failed',
        taskTitle: 'Failed task',
        taskStatus: 'failed',
      };

      executeHook('echo failed', context);

      expect(mockedLaunchSync).toHaveBeenCalledWith(
        'sh',
        ['-c', 'echo failed'],
        expect.objectContaining({
          env: expect.objectContaining({
            ROVER_TASK_STATUS: 'failed',
          }),
        })
      );
    });

    it('should not include ROVER_TASK_STATUS when taskStatus is not provided', () => {
      mockedLaunchSync.mockReturnValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        command: 'sh',
        escapedCommand: 'sh -c "test"',
        failed: false,
        timedOut: false,
        killed: false,
      } as any);

      const context: HookContext = {
        taskId: 44,
        taskBranch: 'task/44-merge',
        taskTitle: 'Merge task',
        // taskStatus not provided
      };

      executeHook('echo merge', context);

      const callArgs = mockedLaunchSync.mock.calls[0];
      expect(callArgs?.[2]?.env).not.toHaveProperty('ROVER_TASK_STATUS');
    });
  });
});
