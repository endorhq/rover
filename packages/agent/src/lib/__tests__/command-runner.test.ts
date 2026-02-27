import { describe, it, expect, vi } from 'vitest';
import {
  resolvePlaceholders,
  truncateOutput,
  shellEscape,
} from '../command-runner.js';

vi.mock('rover-core', async () => {
  const actual =
    await vi.importActual<typeof import('rover-core')>('rover-core');
  return {
    ...actual,
    launch: vi.fn(),
  };
});

describe('truncateOutput', () => {
  it('returns short output unchanged', () => {
    expect(truncateOutput('hello')).toBe('hello');
  });

  it('truncates output exceeding 100KB keeping the tail', () => {
    const large = 'x'.repeat(150_000);
    const result = truncateOutput(large);
    expect(result.length).toBeLessThan(large.length);
    expect(result).toContain('[...truncated 50000 chars...]');
    expect(result.endsWith('x'.repeat(100_000))).toBe(true);
  });

  it('returns output at exactly 100KB unchanged', () => {
    const exact = 'a'.repeat(100_000);
    expect(truncateOutput(exact)).toBe(exact);
  });
});

describe('resolvePlaceholders', () => {
  it('resolves input placeholders', () => {
    const inputs = new Map([['description', 'my task']]);
    const stepsOutput = new Map<string, Map<string, string>>();

    expect(
      resolvePlaceholders('Task: {{inputs.description}}', inputs, stepsOutput)
    ).toBe('Task: my task');
  });

  it('resolves step output placeholders', () => {
    const inputs = new Map<string, string>();
    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('context', new Map([['complexity', 'simple']]));

    expect(
      resolvePlaceholders(
        'Complexity: {{steps.context.outputs.complexity}}',
        inputs,
        stepsOutput
      )
    ).toBe('Complexity: simple');
  });

  it('throws for missing input placeholder', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const inputs = new Map<string, string>();
    const stepsOutput = new Map<string, Map<string, string>>();

    expect(() =>
      resolvePlaceholders('{{inputs.missing}}', inputs, stepsOutput)
    ).toThrow('Unresolved placeholders: {{inputs.missing}}');
  });

  it('throws for missing step output placeholder', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const inputs = new Map<string, string>();
    const stepsOutput = new Map<string, Map<string, string>>();

    expect(() =>
      resolvePlaceholders('{{steps.missing.outputs.val}}', inputs, stepsOutput)
    ).toThrow('Unresolved placeholders: {{steps.missing.outputs.val}}');
  });

  it('resolves multiple placeholders in one string', () => {
    const inputs = new Map([['name', 'test']]);
    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('step1', new Map([['out', 'value1']]));

    expect(
      resolvePlaceholders(
        '{{inputs.name}} and {{steps.step1.outputs.out}}',
        inputs,
        stepsOutput
      )
    ).toBe('test and value1');
  });

  it('throws for unrecognized placeholder patterns', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const inputs = new Map<string, string>();
    const stepsOutput = new Map<string, Map<string, string>>();

    expect(() =>
      resolvePlaceholders('{{unknown.path}}', inputs, stepsOutput)
    ).toThrow('Unresolved placeholders: {{unknown.path}}');
  });

  it('lists all unresolved placeholders in a single error', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const inputs = new Map<string, string>();
    const stepsOutput = new Map<string, Map<string, string>>();

    expect(() =>
      resolvePlaceholders('{{inputs.a}} and {{inputs.b}}', inputs, stepsOutput)
    ).toThrow('Unresolved placeholders: {{inputs.a}}, {{inputs.b}}');
  });
});

describe('shellEscape', () => {
  it('wraps a simple string in single quotes', () => {
    expect(shellEscape('hello')).toBe("'hello'");
  });

  it('escapes embedded single quotes', () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
  });

  it('neutralises shell metacharacters', () => {
    expect(shellEscape('foo; rm -rf /')).toBe("'foo; rm -rf /'");
    expect(shellEscape('$(whoami)')).toBe("'$(whoami)'");
    expect(shellEscape('a && b')).toBe("'a && b'");
    expect(shellEscape('`id`')).toBe("'`id`'");
    expect(shellEscape('a | b')).toBe("'a | b'");
  });

  it('handles empty string', () => {
    expect(shellEscape('')).toBe("''");
  });
});

describe('runCommandStep', () => {
  it('captures stdout, stderr, and exit code from successful command', async () => {
    const { launch } = await import('rover-core');
    const mockedLaunch = vi.mocked(launch);

    mockedLaunch.mockResolvedValue({
      exitCode: 0,
      stdout: 'test output',
      stderr: '',
    } as any);

    const { runCommandStep } = await import('../command-runner.js');

    const step = {
      id: 'test_cmd',
      name: 'Test Command',
      type: 'command' as const,
      command: 'echo',
      args: ['hello'],
    };

    const result = await runCommandStep(step, new Map(), new Map());

    expect(result.id).toBe('test_cmd');
    expect(result.success).toBe(true);
    expect(result.outputs.get('exit_code')).toBe('0');
    expect(result.outputs.get('stdout')).toBe('test output');
    expect(result.outputs.get('success')).toBe('true');
  });

  it('captures non-zero exit code as failure', async () => {
    const { launch } = await import('rover-core');
    const mockedLaunch = vi.mocked(launch);

    mockedLaunch.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'test failed',
    } as any);

    const { runCommandStep } = await import('../command-runner.js');

    const step = {
      id: 'failing_cmd',
      name: 'Failing Command',
      type: 'command' as const,
      command: 'false',
    };

    const result = await runCommandStep(step, new Map(), new Map());

    expect(result.id).toBe('failing_cmd');
    expect(result.success).toBe(false);
    expect(result.outputs.get('exit_code')).toBe('1');
    expect(result.outputs.get('stderr')).toBe('test failed');
    expect(result.outputs.get('success')).toBe('false');
    expect(result.error).toBeDefined();
  });

  it('passes timeoutSeconds to launch as milliseconds', async () => {
    const { launch } = await import('rover-core');
    const mockedLaunch = vi.mocked(launch);

    mockedLaunch.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    } as any);

    const { runCommandStep } = await import('../command-runner.js');

    const step = {
      id: 'timeout_cmd',
      name: 'Timeout Command',
      type: 'command' as const,
      command: 'sleep 1',
    };

    await runCommandStep(step, new Map(), new Map(), 60);

    expect(mockedLaunch).toHaveBeenCalledWith(
      'bash',
      [
        '-c',
        '[ -f "$HOME/.profile" ] && . "$HOME/.profile" 2>/dev/null; sleep 1',
      ],
      expect.objectContaining({ timeout: 60_000 })
    );
  });

  it('uses default timeout when timeoutSeconds not provided', async () => {
    const { launch } = await import('rover-core');
    const mockedLaunch = vi.mocked(launch);

    mockedLaunch.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    } as any);

    const { runCommandStep } = await import('../command-runner.js');

    const step = {
      id: 'default_timeout_cmd',
      name: 'Default Timeout',
      type: 'command' as const,
      command: 'echo hi',
    };

    await runCommandStep(step, new Map(), new Map());

    // Default is 300 seconds = 300_000 ms
    expect(mockedLaunch).toHaveBeenCalledWith(
      'bash',
      [
        '-c',
        '[ -f "$HOME/.profile" ] && . "$HOME/.profile" 2>/dev/null; echo hi',
      ],
      expect.objectContaining({ timeout: 300_000 })
    );
  });

  it('resolves placeholders in command and args', async () => {
    const { launch } = await import('rover-core');
    const mockedLaunch = vi.mocked(launch);

    mockedLaunch.mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    } as any);

    const { runCommandStep } = await import('../command-runner.js');

    const step = {
      id: 'dynamic_cmd',
      name: 'Dynamic Command',
      type: 'command' as const,
      command: '{{inputs.test_command}}',
      args: ['--filter', '{{steps.context.outputs.test_pattern}}'],
    };

    const inputs = new Map([['test_command', 'npm test']]);
    const stepsOutput = new Map<string, Map<string, string>>();
    stepsOutput.set('context', new Map([['test_pattern', 'unit']]));

    await runCommandStep(step, inputs, stepsOutput);

    // Command runs through shell; args are shell-escaped
    expect(mockedLaunch).toHaveBeenCalledWith(
      'bash',
      [
        '-c',
        '[ -f "$HOME/.profile" ] && . "$HOME/.profile" 2>/dev/null; npm test \'--filter\' \'unit\'',
      ],
      expect.objectContaining({ reject: false })
    );
  });
});
