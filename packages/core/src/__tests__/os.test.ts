import { describe, expect, it, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('launchSync', () => {
  it('normalizes Node sync spawn EPERM errors when the command exited successfully', async () => {
    const execaError = Object.assign(new Error('spawnSync echo EPERM'), {
      failed: true,
      code: 'EPERM',
      exitCode: 0,
      stdout: 'hello',
      stderr: '',
      shortMessage: 'Command failed with EPERM: echo hello',
      originalMessage: 'spawnSync echo EPERM',
    });

    const execaSyncMock = vi.fn(() => {
      throw execaError;
    });

    vi.doMock('execa', () => ({
      execa: vi.fn(),
      execaSync: execaSyncMock,
      parseCommandString: vi.fn(() => ['echo', 'hello']),
    }));

    const { launchSync } = await import('../os.js');
    const result = launchSync('echo', ['hello']);

    expect(result.failed).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
    expect(result.code).toBeUndefined();
  });

  it('normalizes EPERM on the return path (non-thrown) when exitCode is 0', async () => {
    const execaResult = {
      failed: true,
      code: 'EPERM',
      exitCode: 0,
      stdout: 'world',
      stderr: '',
      shortMessage: 'Command failed with EPERM: echo world',
      originalMessage: 'spawnSync echo EPERM',
      message: 'spawnSync echo EPERM',
    };

    vi.doMock('execa', () => ({
      execa: vi.fn(),
      execaSync: vi.fn(() => execaResult),
      parseCommandString: vi.fn(() => ['echo', 'world']),
    }));

    const { launchSync } = await import('../os.js');
    const result = launchSync('echo', ['world']);

    expect(result.failed).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('world');
    expect(result.code).toBeUndefined();
    // Diagnostic messages should be cleared
    expect(result.message).toBe('');
    expect(result.shortMessage).toBe('');
  });

  it('does NOT normalize genuine EPERM errors with non-zero exit code', async () => {
    const execaError = Object.assign(new Error('spawnSync cat EPERM'), {
      failed: true,
      code: 'EPERM',
      exitCode: 1,
      stdout: '',
      stderr: 'Permission denied',
      shortMessage: 'Command failed with EPERM: cat /etc/shadow',
      originalMessage: 'spawnSync cat EPERM',
    });

    vi.doMock('execa', () => ({
      execa: vi.fn(),
      execaSync: vi.fn(() => {
        throw execaError;
      }),
      parseCommandString: vi.fn(() => ['cat', '/etc/shadow']),
    }));

    const { launchSync } = await import('../os.js');

    expect(() => launchSync('cat', ['/etc/shadow'])).toThrow('EPERM');
  });

  it('does NOT normalize non-EPERM errors', async () => {
    const execaError = Object.assign(new Error('spawnSync fail'), {
      failed: true,
      code: 'ENOENT',
      exitCode: 127,
      stdout: '',
      stderr: 'command not found',
      shortMessage: 'Command failed: nonexistent',
      originalMessage: 'spawnSync nonexistent ENOENT',
    });

    vi.doMock('execa', () => ({
      execa: vi.fn(),
      execaSync: vi.fn(() => {
        throw execaError;
      }),
      parseCommandString: vi.fn(() => ['nonexistent']),
    }));

    const { launchSync } = await import('../os.js');

    expect(() => launchSync('nonexistent')).toThrow('spawnSync fail');
  });
});
