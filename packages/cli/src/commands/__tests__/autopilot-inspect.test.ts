import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActionTrace, Span, Action } from '../../lib/autopilot/types.js';

// ---------- shared state for mocks ----------

let testBaseDir: string;
let consoleSpy: ReturnType<typeof vi.spyOn>;

// ---------- module mocks ----------

vi.mock('rover-core', async () => {
  const actual = await vi.importActual('rover-core');
  return {
    ...actual,
    getProjectPath: vi.fn().mockImplementation(() => testBaseDir),
    showTitle: vi.fn(),
    showProperties: vi.fn(),
    showList: vi.fn(),
    showTips: vi.fn(),
  };
});

vi.mock('../../lib/context.js', () => ({
  isJsonMode: vi.fn().mockReturnValue(false),
  setJsonMode: vi.fn(),
  requireProjectContext: vi.fn().mockResolvedValue({
    id: 'test-project-id',
    name: 'test-project',
    path: '/fake/path',
  }),
}));

vi.mock('../../utils/exit.js', () => ({
  exitWithError: vi.fn(),
  exitWithSuccess: vi.fn(),
}));

vi.mock('../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue(undefined),
}));

// ---------- helpers ----------

function makeSpan(overrides: Partial<Span> = {}): Span {
  return {
    id: 'span-001',
    version: '1.0',
    timestamp: '2026-03-01T10:00:00.000Z',
    step: 'coordinate',
    parent: null,
    status: 'completed',
    completed: '2026-03-01T10:00:05.000Z',
    summary: 'Coordinated event processing',
    meta: {},
    originAction: null,
    newActions: [],
    ...overrides,
  };
}

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: 'action-001',
    version: '1.0',
    action: 'plan',
    timestamp: '2026-03-01T10:00:05.000Z',
    spanId: 'span-001',
    meta: {},
    reasoning: 'Planning the implementation',
    ...overrides,
  };
}

function makeTrace(overrides: Partial<ActionTrace> = {}): ActionTrace {
  return {
    traceId: 'trace-001',
    summary: 'Handle issue #42',
    steps: [
      {
        originAction: null,
        action: 'coordinate',
        status: 'completed',
        timestamp: '2026-03-01T10:00:00.000Z',
        spanId: 'span-001',
        newActions: ['action-001'],
      },
      {
        originAction: 'action-001',
        action: 'plan',
        status: 'completed',
        timestamp: '2026-03-01T10:00:05.000Z',
        reasoning: 'Creating implementation plan',
        spanId: 'span-002',
        newActions: [],
        terminal: true,
      },
    ],
    createdAt: '2026-03-01T10:00:00.000Z',
    ...overrides,
  };
}

function writeSpanFile(dir: string, span: Span): void {
  const spansDir = join(dir, 'spans');
  mkdirSync(spansDir, { recursive: true });
  writeFileSync(join(spansDir, `${span.id}.json`), JSON.stringify(span));
}

function writeActionFile(dir: string, action: Action): void {
  const actionsDir = join(dir, 'actions');
  mkdirSync(actionsDir, { recursive: true });
  writeFileSync(join(actionsDir, `${action.id}.json`), JSON.stringify(action));
}

function writeTracesFile(dir: string, traces: Map<string, ActionTrace>): void {
  const autopilotDir = join(dir, 'autopilot');
  mkdirSync(autopilotDir, { recursive: true });
  writeFileSync(
    join(autopilotDir, 'traces.json'),
    JSON.stringify(Object.fromEntries(traces))
  );
}

function writeStateFile(dir: string, state: Record<string, unknown>): void {
  const autopilotDir = join(dir, 'autopilot');
  mkdirSync(autopilotDir, { recursive: true });
  writeFileSync(
    join(autopilotDir, 'state.json'),
    JSON.stringify({
      version: '1.0',
      pending: [],
      updatedAt: new Date().toISOString(),
      ...state,
    })
  );
}

// ---------- tests ----------

describe('autopilot inspect command', () => {
  beforeEach(async () => {
    testBaseDir = mkdtempSync(join(tmpdir(), 'rover-autopilot-inspect-'));
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Reset isJsonMode to false before each test (JSON tests override it)
    const { isJsonMode } = await import('../../lib/context.js');
    vi.mocked(isJsonMode).mockReturnValue(false);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    rmSync(testBaseDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('argument validation (commander level)', () => {
    it('rejects invalid type via commander choices', async () => {
      const { createProgram } = await import('../../program.js');
      const program = createProgram({ excludeRuntimeHooks: true });

      // Commander exits with error on invalid choices
      program.exitOverride();

      await expect(
        program.parseAsync([
          'node',
          'rover',
          'autopilot',
          'inspect',
          'invalid',
          'some-uuid',
        ])
      ).rejects.toThrow();
    });
  });

  describe('trace inspection', () => {
    it('displays trace in human-readable format', async () => {
      const trace = makeTrace();
      const span = makeSpan();
      const tracesMap = new Map([['trace-001', trace]]);

      writeTracesFile(testBaseDir, tracesMap);
      writeSpanFile(testBaseDir, span);
      writeStateFile(testBaseDir, {});

      const { inspectAutopilotCommand } = await import(
        '../autopilot/inspect.js'
      );
      const { exitWithSuccess } = await import('../../utils/exit.js');
      const { showTitle, showProperties } = await import('rover-core');

      await inspectAutopilotCommand('trace', 'trace-001');

      expect(showTitle).toHaveBeenCalledWith('Trace');
      expect(showProperties).toHaveBeenCalledWith(
        expect.objectContaining({
          'Trace ID': 'trace-001',
          Summary: 'Handle issue #42',
        })
      );
      expect(exitWithSuccess).toHaveBeenCalledWith(
        null,
        { success: true },
        expect.any(Object)
      );
    });

    it('displays trace with task mapping', async () => {
      const trace = makeTrace();
      const tracesMap = new Map([['trace-001', trace]]);

      writeTracesFile(testBaseDir, tracesMap);
      writeStateFile(testBaseDir, {
        taskMappings: {
          'action-001': {
            taskId: 5,
            branchName: 'rover/task-5',
            traceId: 'trace-001',
          },
        },
      });

      const { inspectAutopilotCommand } = await import(
        '../autopilot/inspect.js'
      );
      const { showProperties } = await import('rover-core');

      await inspectAutopilotCommand('trace', 'trace-001');

      expect(showProperties).toHaveBeenCalledWith(
        expect.objectContaining({
          'Task ID': '5',
          Branch: 'rover/task-5',
        })
      );
    });

    it('outputs enriched JSON with --json flag', async () => {
      const trace = makeTrace();
      const span = makeSpan();
      const action = makeAction();
      const tracesMap = new Map([['trace-001', trace]]);

      writeTracesFile(testBaseDir, tracesMap);
      writeSpanFile(testBaseDir, span);
      writeActionFile(testBaseDir, action);
      writeStateFile(testBaseDir, {});

      const { isJsonMode } = await import('../../lib/context.js');
      vi.mocked(isJsonMode).mockReturnValue(true);

      const { inspectAutopilotCommand } = await import(
        '../autopilot/inspect.js'
      );
      const { exitWithSuccess } = await import('../../utils/exit.js');

      await inspectAutopilotCommand('trace', 'trace-001', { json: true });

      expect(exitWithSuccess).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          success: true,
          type: 'trace',
          traceId: 'trace-001',
          summary: 'Handle issue #42',
          steps: expect.arrayContaining([
            expect.objectContaining({
              action: 'coordinate',
              span: expect.objectContaining({ id: 'span-001' }),
            }),
          ]),
        }),
        expect.any(Object)
      );
    });

    it('shows error when trace not found', async () => {
      writeTracesFile(testBaseDir, new Map());
      writeStateFile(testBaseDir, {});

      const { inspectAutopilotCommand } = await import(
        '../autopilot/inspect.js'
      );
      const { exitWithError } = await import('../../utils/exit.js');

      await inspectAutopilotCommand('trace', 'nonexistent');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Trace "nonexistent" not found'),
        }),
        expect.any(Object)
      );
    });
  });

  describe('span inspection', () => {
    it('displays span with properties and status colors', async () => {
      const span = makeSpan();
      writeSpanFile(testBaseDir, span);

      const { inspectAutopilotCommand } = await import(
        '../autopilot/inspect.js'
      );
      const { exitWithSuccess } = await import('../../utils/exit.js');
      const { showTitle, showProperties } = await import('rover-core');

      await inspectAutopilotCommand('span', 'span-001');

      expect(showTitle).toHaveBeenCalledWith(
        expect.stringContaining('span-001')
      );
      expect(showProperties).toHaveBeenCalledWith(
        expect.objectContaining({
          'Span ID': 'span-001',
          Step: 'coordinate',
        })
      );
      expect(exitWithSuccess).toHaveBeenCalled();
    });

    it('shows parent chain when ancestors exist', async () => {
      const rootSpan = makeSpan({ id: 'span-root', step: 'event' });
      const childSpan = makeSpan({
        id: 'span-child',
        step: 'coordinate',
        parent: 'span-root',
      });

      writeSpanFile(testBaseDir, rootSpan);
      writeSpanFile(testBaseDir, childSpan);

      const { inspectAutopilotCommand } = await import(
        '../autopilot/inspect.js'
      );
      const { showTitle, showList } = await import('rover-core');

      await inspectAutopilotCommand('span', 'span-child');

      expect(showTitle).toHaveBeenCalledWith('Parent Chain');
      expect(showList).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining('event'),
          expect.stringContaining('coordinate'),
        ])
      );
    });

    it('displays metadata section when present', async () => {
      const span = makeSpan({
        meta: { issueNumber: 42, labels: ['bug', 'urgent'] },
      });
      writeSpanFile(testBaseDir, span);

      const { inspectAutopilotCommand } = await import(
        '../autopilot/inspect.js'
      );
      const { showTitle, showProperties } = await import('rover-core');

      await inspectAutopilotCommand('span', 'span-001');

      expect(showTitle).toHaveBeenCalledWith('Metadata');
      expect(showProperties).toHaveBeenCalledWith(
        expect.objectContaining({
          issueNumber: expect.any(String),
        })
      );
    });

    it('outputs JSON with parent trace', async () => {
      const rootSpan = makeSpan({ id: 'span-root', step: 'event' });
      const childSpan = makeSpan({
        id: 'span-child',
        step: 'coordinate',
        parent: 'span-root',
      });

      writeSpanFile(testBaseDir, rootSpan);
      writeSpanFile(testBaseDir, childSpan);

      const { isJsonMode } = await import('../../lib/context.js');
      vi.mocked(isJsonMode).mockReturnValue(true);

      const { inspectAutopilotCommand } = await import(
        '../autopilot/inspect.js'
      );
      const { exitWithSuccess } = await import('../../utils/exit.js');

      await inspectAutopilotCommand('span', 'span-child', { json: true });

      expect(exitWithSuccess).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          success: true,
          type: 'span',
          id: 'span-child',
          parentTrace: expect.arrayContaining([
            expect.objectContaining({ id: 'span-root' }),
            expect.objectContaining({ id: 'span-child' }),
          ]),
        }),
        expect.any(Object)
      );
    });

    it('shows error when span not found', async () => {
      const { inspectAutopilotCommand } = await import(
        '../autopilot/inspect.js'
      );
      const { exitWithError } = await import('../../utils/exit.js');

      await inspectAutopilotCommand('span', 'nonexistent');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Span "nonexistent" not found'),
        }),
        expect.any(Object)
      );
    });
  });

  describe('action inspection', () => {
    it('displays action with reasoning and metadata', async () => {
      const action = makeAction({
        meta: { priority: 'high' },
      });
      const span = makeSpan();
      writeActionFile(testBaseDir, action);
      writeSpanFile(testBaseDir, span);

      const { inspectAutopilotCommand } = await import(
        '../autopilot/inspect.js'
      );
      const { exitWithSuccess } = await import('../../utils/exit.js');
      const { showTitle, showProperties } = await import('rover-core');

      await inspectAutopilotCommand('action', 'action-001');

      expect(showTitle).toHaveBeenCalledWith(
        expect.stringContaining('action-001')
      );
      expect(showProperties).toHaveBeenCalledWith(
        expect.objectContaining({
          'Action ID': 'action-001',
          Action: 'plan',
        })
      );
      // Metadata section
      expect(showTitle).toHaveBeenCalledWith('Metadata');
      // Linked span section
      expect(showTitle).toHaveBeenCalledWith('Linked Span');
      expect(exitWithSuccess).toHaveBeenCalled();
    });

    it('outputs JSON with linked span', async () => {
      const action = makeAction();
      const span = makeSpan();
      writeActionFile(testBaseDir, action);
      writeSpanFile(testBaseDir, span);

      const { isJsonMode } = await import('../../lib/context.js');
      vi.mocked(isJsonMode).mockReturnValue(true);

      const { inspectAutopilotCommand } = await import(
        '../autopilot/inspect.js'
      );
      const { exitWithSuccess } = await import('../../utils/exit.js');

      await inspectAutopilotCommand('action', 'action-001', { json: true });

      expect(exitWithSuccess).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          success: true,
          type: 'action',
          id: 'action-001',
          action: 'plan',
          linkedSpan: expect.objectContaining({ id: 'span-001' }),
        }),
        expect.any(Object)
      );
    });

    it('shows error when action not found', async () => {
      const { inspectAutopilotCommand } = await import(
        '../autopilot/inspect.js'
      );
      const { exitWithError } = await import('../../utils/exit.js');

      await inspectAutopilotCommand('action', 'nonexistent');

      expect(exitWithError).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.stringContaining('Action "nonexistent" not found'),
        }),
        expect.any(Object)
      );
    });
  });

  describe('--project-id flag', () => {
    it('passes project-id override to requireProjectContext', async () => {
      writeTracesFile(testBaseDir, new Map());
      writeStateFile(testBaseDir, {});

      const { requireProjectContext } = await import('../../lib/context.js');

      const { inspectAutopilotCommand } = await import(
        '../autopilot/inspect.js'
      );

      // Will fail to find trace but we're testing the project resolution
      await inspectAutopilotCommand('trace', 'any-id', {
        projectId: 'custom-project',
      });

      expect(requireProjectContext).toHaveBeenCalledWith('custom-project');
    });
  });
});

describe('autopilot inspect command definition metadata', () => {
  it('has correct name and parent', async () => {
    const inspectCmd = (await import('../autopilot/inspect.js')).default;
    expect(inspectCmd.name).toBe('inspect');
    expect(inspectCmd.parent).toBe('autopilot');
  });

  it('requires a project', async () => {
    const inspectCmd = (await import('../autopilot/inspect.js')).default;
    expect(inspectCmd.requireProject).toBe(true);
  });
});

describe('autopilot inspect command registration', () => {
  it('registers "inspect" under "autopilot" in the program', async () => {
    const { createProgram } = await import('../../program.js');
    const program = createProgram({ excludeRuntimeHooks: true });

    const autopilotCmd = program.commands.find(
      (c: any) => c.name() === 'autopilot'
    );
    expect(autopilotCmd).toBeDefined();

    const inspectSubCmd = autopilotCmd!.commands.find(
      (c: any) => c.name() === 'inspect'
    );
    expect(inspectSubCmd).toBeDefined();
  });

  it('has --json and --project-id options', async () => {
    const { createProgram } = await import('../../program.js');
    const program = createProgram({ excludeRuntimeHooks: true });

    const autopilotCmd = program.commands.find(
      (c: any) => c.name() === 'autopilot'
    )!;
    const inspectSubCmd = autopilotCmd.commands.find(
      (c: any) => c.name() === 'inspect'
    )!;
    const optionFlags = inspectSubCmd.options.map((o: any) => o.long);

    expect(optionFlags).toContain('--json');
    expect(optionFlags).toContain('--project-id');
  });
});

describe('formatDuration', () => {
  it('returns "--" when no start time provided', async () => {
    const { formatDuration } = await vi.importActual<
      typeof import('../../lib/autopilot/helpers.js')
    >('../../lib/autopilot/helpers.js');

    expect(formatDuration()).toBe('--');
    expect(formatDuration(undefined)).toBe('--');
  });

  it('formats seconds correctly', async () => {
    const { formatDuration } = await vi.importActual<
      typeof import('../../lib/autopilot/helpers.js')
    >('../../lib/autopilot/helpers.js');

    expect(
      formatDuration('2026-03-01T10:00:00.000Z', '2026-03-01T10:00:45.000Z')
    ).toBe('45s');
  });

  it('formats minutes and seconds', async () => {
    const { formatDuration } = await vi.importActual<
      typeof import('../../lib/autopilot/helpers.js')
    >('../../lib/autopilot/helpers.js');

    expect(
      formatDuration('2026-03-01T10:00:00.000Z', '2026-03-01T10:02:30.000Z')
    ).toBe('2m 30s');
  });

  it('formats hours and minutes', async () => {
    const { formatDuration } = await vi.importActual<
      typeof import('../../lib/autopilot/helpers.js')
    >('../../lib/autopilot/helpers.js');

    expect(
      formatDuration('2026-03-01T10:00:00.000Z', '2026-03-01T11:15:00.000Z')
    ).toBe('1h 15m');
  });
});
