import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------- shared state for mocks ----------
let testBaseDir: string;

// ---------- module mocks ----------

vi.mock('rover-core', async () => {
  const actual = await vi.importActual('rover-core');
  return {
    ...actual,
    getProjectPath: vi.fn().mockImplementation(() => testBaseDir),
  };
});

vi.mock('ink', () => ({
  render: vi.fn().mockReturnValue({
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../lib/context.js', () => ({
  getDefaultProject: vi.fn().mockReturnValue(null),
  isJsonMode: vi.fn().mockReturnValue(false),
}));

vi.mock('../../utils/exit.js', () => ({
  exitWithError: vi.fn().mockImplementation(() => {}),
}));

vi.mock('../../lib/autopilot/helpers.js', () => ({
  ensureTraceDirs: vi.fn(),
}));

vi.mock('../../lib/autopilot/views/index.js', () => ({
  LaunchableApp: () => null,
}));

// ---------- helpers ----------

/** A minimal object satisfying the shape expected by the dashboard action. */
function fakeProject(id = 'test-project-id') {
  return { id, name: 'test-project', path: '/fake/path' } as any;
}

// ---------- tests ----------

describe('ensureTraceDirs (real filesystem)', () => {
  beforeEach(() => {
    testBaseDir = mkdtempSync(join(tmpdir(), 'rover-autopilot-test-'));
  });

  afterEach(() => {
    rmSync(testBaseDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('creates spans/ and actions/ directories', async () => {
    // Use the real implementation, not the mock
    const { ensureTraceDirs: realEnsureTraceDirs } = await vi.importActual<
      typeof import('../../lib/autopilot/helpers.js')
    >('../../lib/autopilot/helpers.js');

    realEnsureTraceDirs('any-project-id');

    expect(existsSync(join(testBaseDir, 'spans'))).toBe(true);
    expect(existsSync(join(testBaseDir, 'actions'))).toBe(true);
  });

  it('is idempotent — calling twice does not throw', async () => {
    const { ensureTraceDirs: realEnsureTraceDirs } = await vi.importActual<
      typeof import('../../lib/autopilot/helpers.js')
    >('../../lib/autopilot/helpers.js');

    realEnsureTraceDirs('any-project-id');
    expect(() => realEnsureTraceDirs('any-project-id')).not.toThrow();
  });

  it('works when base path does not yet exist (recursive: true)', async () => {
    // Point getProjectPath at a nested path that doesn't exist yet
    const nested = join(testBaseDir, 'a', 'b', 'c');
    const { getProjectPath } = await import('rover-core');
    vi.mocked(getProjectPath).mockReturnValue(nested);

    const { ensureTraceDirs: realEnsureTraceDirs } = await vi.importActual<
      typeof import('../../lib/autopilot/helpers.js')
    >('../../lib/autopilot/helpers.js');

    realEnsureTraceDirs('any-project-id');

    expect(existsSync(join(nested, 'spans'))).toBe(true);
    expect(existsSync(join(nested, 'actions'))).toBe(true);

    // Restore mock to testBaseDir for subsequent tests
    vi.mocked(getProjectPath).mockReturnValue(testBaseDir);
  });
});

describe('autopilot command action', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutWriteSpy: any;
  let exitListeners: ((...args: any[]) => void)[] = [];
  let sigintListeners: ((...args: any[]) => void)[] = [];

  beforeEach(() => {
    testBaseDir = mkdtempSync(join(tmpdir(), 'rover-autopilot-test-'));

    stdoutWriteSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);

    // Capture process event listeners so they don't leak between tests
    const origOn = process.on.bind(process);
    vi.spyOn(process, 'on').mockImplementation((event: any, fn: any) => {
      if (event === 'exit') exitListeners.push(fn);
      else if (event === 'SIGINT') sigintListeners.push(fn);
      else origOn(event, fn);
      return process;
    });
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    vi.mocked(process.on).mockRestore();
    rmSync(testBaseDir, { recursive: true, force: true });
    vi.clearAllMocks();
    exitListeners = [];
    sigintListeners = [];
  });

  it('exits with error when no project is available', async () => {
    const { getDefaultProject } = await import('../../lib/context.js');
    vi.mocked(getDefaultProject).mockReturnValue(null);

    const { exitWithError } = await import('../../utils/exit.js');
    const { render } = await import('ink');

    const dashboardCmd = (await import('../autopilot/dashboard.js')).default;

    await dashboardCmd.action();

    expect(exitWithError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('project'),
        success: false,
      })
    );
    expect(render).not.toHaveBeenCalled();
  });

  it('exits with error on invalid --mode value', async () => {
    const { getDefaultProject } = await import('../../lib/context.js');
    vi.mocked(getDefaultProject).mockReturnValue(fakeProject());

    const { exitWithError } = await import('../../utils/exit.js');

    const dashboardCmd = (await import('../autopilot/dashboard.js')).default;

    await dashboardCmd.action({ mode: 'invalid' });

    expect(exitWithError).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('Invalid --mode'),
        success: false,
      })
    );
  });

  it('defaults mode to "self-driving" and calls ensureTraceDirs + render', async () => {
    const { getDefaultProject } = await import('../../lib/context.js');
    vi.mocked(getDefaultProject).mockReturnValue(fakeProject());

    const { ensureTraceDirs } = await import('../../lib/autopilot/helpers.js');
    const { render } = await import('ink');

    const dashboardCmd = (await import('../autopilot/dashboard.js')).default;

    await dashboardCmd.action();

    expect(ensureTraceDirs).toHaveBeenCalledWith('test-project-id');
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          mode: 'self-driving',
          allowEvents: 'maintainers',
        }),
      })
    );
  });

  it('writes alt-screen enter sequence before render and leave after', async () => {
    const { getDefaultProject } = await import('../../lib/context.js');
    vi.mocked(getDefaultProject).mockReturnValue(fakeProject());

    const dashboardCmd = (await import('../autopilot/dashboard.js')).default;

    await dashboardCmd.action();

    const writes = stdoutWriteSpy.mock.calls.map((c: any[]) => c[0]);

    // First write enters alt screen + hides cursor
    expect(writes[0]).toContain('\x1b[?1049h');
    // After waitUntilExit resolves, should restore
    expect(
      writes.some(
        (w: any) => typeof w === 'string' && w.includes('\x1b[?1049l')
      )
    ).toBe(true);
  });
});

describe('autopilot command definition metadata', () => {
  it('has name "autopilot"', async () => {
    const dashboardCmd = (await import('../autopilot/dashboard.js')).default;
    expect(dashboardCmd.name).toBe('autopilot');
  });

  it('requires a project', async () => {
    const dashboardCmd = (await import('../autopilot/dashboard.js')).default;
    expect(dashboardCmd.requireProject).toBe(true);
  });
});

describe('autopilot command registration', () => {
  it('registers the "autopilot" command in the program', async () => {
    const { createProgram } = await import('../../program.js');
    const program = createProgram({ excludeRuntimeHooks: true });

    const cmd = program.commands.find((c: any) => c.name() === 'autopilot');
    expect(cmd).toBeDefined();
  });

  it('has --mode and --allow-events options', async () => {
    const { createProgram } = await import('../../program.js');
    const program = createProgram({ excludeRuntimeHooks: true });

    const cmd = program.commands.find((c: any) => c.name() === 'autopilot')!;
    const optionFlags = cmd.options.map((o: any) => o.long);

    expect(optionFlags).toContain('--mode');
    expect(optionFlags).toContain('--allow-events');
  });
});
