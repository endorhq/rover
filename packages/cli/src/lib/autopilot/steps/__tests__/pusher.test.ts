import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActionTrace, PendingAction } from '../../types.js';
import { pusherStep } from '../pusher.js';
import type { StepContext } from '../types.js';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLaunch = vi.fn();
vi.mock('rover-core', async importOriginal => {
  const actual = await importOriginal<typeof import('rover-core')>();
  return {
    ...actual,
    launch: (...args: any[]) => mockLaunch(...args),
    getDataDir: () => '/tmp/rover-test-data',
    Git: vi.fn().mockImplementation(() => ({
      getMainBranch: () => 'main',
    })),
  };
});

const mockInvokeAI = vi.fn();
vi.mock('../ai.js', () => ({
  invokeAI: (...args: any[]) => mockInvokeAI(...args),
  appendPromptSuffix: (prompt: string) => prompt,
}));

let spanWriterInstances: any[] = [];
vi.mock('../../logging.js', () => {
  return {
    SpanWriter: vi.fn().mockImplementation((_projectId: string, opts: any) => {
      const instance = {
        id: `span-${Math.random().toString(36).slice(2, 8)}`,
        step: opts.step,
        parentId: opts.parentId,
        meta: opts.meta ?? {},
        status: 'running' as string,
        complete: vi.fn().mockImplementation(function (this: any) {
          this.status = 'completed';
        }),
        fail: vi.fn().mockImplementation(function (this: any) {
          this.status = 'failed';
        }),
        error: vi.fn().mockImplementation(function (this: any) {
          this.status = 'error';
        }),
      };
      spanWriterInstances.push(instance);
      return instance;
    }),
    emitAction: vi.fn().mockReturnValue({ id: 'mock-action-id' }),
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTrace(overrides: Partial<ActionTrace> = {}): ActionTrace {
  return {
    traceId: 'trace-1',
    summary: 'test trace',
    steps: [
      {
        originAction: 'workflow-action-1',
        action: 'workflow',
        status: 'completed',
        timestamp: new Date().toISOString(),
      },
    ],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePending(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    traceId: 'trace-1',
    actionId: 'push-action-1',
    spanId: 'span-1',
    action: 'push',
    summary: 'test push',
    createdAt: new Date().toISOString(),
    meta: {},
    ...overrides,
  };
}

function makeStepContext(overrides: Partial<StepContext> = {}): StepContext {
  return {
    store: {
      getSpanTrace: vi.fn().mockReturnValue([]),
      removePending: vi.fn(),
      addPending: vi.fn(),
      appendLog: vi.fn(),
      getTaskMapping: vi.fn().mockReturnValue({
        taskId: 1,
        branchName: 'rover/task-1',
      }),
    } as any,
    projectId: 'proj-1',
    projectPath: '/tmp/test-project',
    trace: makeTrace(),
    owner: 'test-owner',
    repo: 'test-repo',
    project: {
      id: 'proj-1',
      path: '/tmp/test-project',
      getTask: vi.fn().mockReturnValue({ worktreePath: '/tmp/worktree' }),
    } as any,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('pusherStep.process — assistant mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spanWriterInstances = [];
    // Default: no existing PR
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify([]),
      stderr: '',
    });
  });

  it('returns terminal: true with empty enqueuedActions', async () => {
    const ctx = makeStepContext({ mode: 'assistant' });
    const result = await pusherStep.process(makePending(), ctx);

    expect(result.terminal).toBe(true);
    expect(result.enqueuedActions).toEqual([]);
  });

  it('does not invoke the AI agent', async () => {
    const ctx = makeStepContext({ mode: 'assistant' });
    await pusherStep.process(makePending(), ctx);

    expect(mockInvokeAI).not.toHaveBeenCalled();
  });

  it('creates span with dryRun metadata and commands', async () => {
    const ctx = makeStepContext({ mode: 'assistant' });
    await pusherStep.process(makePending(), ctx);

    expect(spanWriterInstances.length).toBeGreaterThanOrEqual(1);
    const pushSpan = spanWriterInstances.find(
      s => s.step === 'push' && s.meta.dryRun
    );
    expect(pushSpan).toBeDefined();
    expect(pushSpan.meta.dryRun).toBe(true);
    expect(pushSpan.meta.commands).toBeInstanceOf(Array);
    expect(pushSpan.complete).toHaveBeenCalled();
  });

  it('generates git push and gh pr create commands', async () => {
    const ctx = makeStepContext({ mode: 'assistant' });
    await pusherStep.process(makePending(), ctx);

    const pushSpan = spanWriterInstances.find(
      s => s.step === 'push' && s.meta.dryRun
    );
    const commands = pushSpan.meta.commands as string[];

    expect(commands.some((c: string) => c.includes('git push origin'))).toBe(
      true
    );
    expect(commands.some((c: string) => c.includes('gh pr create'))).toBe(true);
  });

  it('notes existing PR URL instead of gh pr create', async () => {
    // Return an existing PR from the gh pr list mock
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify([
        {
          number: 42,
          url: 'https://github.com/test-owner/test-repo/pull/42',
          state: 'OPEN',
        },
      ]),
      stderr: '',
    });

    const ctx = makeStepContext({ mode: 'assistant' });
    await pusherStep.process(makePending(), ctx);

    const pushSpan = spanWriterInstances.find(
      s => s.step === 'push' && s.meta.dryRun
    );
    const commands = pushSpan.meta.commands as string[];

    expect(commands.some((c: string) => c.includes('PR already exists'))).toBe(
      true
    );
    expect(commands.some((c: string) => c.includes('gh pr create'))).toBe(
      false
    );
  });

  it('removes the pending action from the store', async () => {
    const ctx = makeStepContext({ mode: 'assistant' });
    const pending = makePending();
    await pusherStep.process(pending, ctx);

    expect(ctx.store.removePending).toHaveBeenCalledWith(pending.actionId);
  });

  it('includes branch names in the reasoning', async () => {
    const ctx = makeStepContext({ mode: 'assistant' });
    const result = await pusherStep.process(makePending(), ctx);

    expect(result.reasoning).toContain('dry-run');
    expect(result.reasoning).toContain('git push origin');
  });
});
