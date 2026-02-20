import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Span, ActionTrace, PendingAction } from '../../types.js';
import { resolveChannel, buildFallbackMessage, notifyStep } from '../notify.js';
import type { StepContext } from '../types.js';

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mock rover-core (launch + getDataDir)
const mockLaunch = vi.fn();
vi.mock('rover-core', async importOriginal => {
  const actual = await importOriginal<typeof import('rover-core')>();
  return {
    ...actual,
    launch: (...args: any[]) => mockLaunch(...args),
    getDataDir: () => '/tmp/rover-test-data',
  };
});

// Mock AI agent
const mockInvoke = vi.fn();
vi.mock('../../../agents/index.js', () => ({
  getUserAIAgent: () => 'claude',
  getAIAgentTool: () => ({ invoke: mockInvoke }),
}));

// Mock SpanWriter — avoid file I/O
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
    ActionWriter: vi.fn().mockImplementation(() => ({
      id: 'mock-action-id',
      data: { action: 'noop', meta: {} },
    })),
    enqueueAction: vi.fn(),
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makeSpan(overrides: Partial<Span> = {}): Span {
  return {
    id: 'span-1',
    version: '1.0',
    timestamp: new Date().toISOString(),
    step: 'event',
    parent: null,
    status: 'completed',
    completed: new Date().toISOString(),
    summary: 'test span',
    meta: {},
    ...overrides,
  };
}

function makeTrace(overrides: Partial<ActionTrace> = {}): ActionTrace {
  return {
    traceId: 'trace-1',
    summary: 'test trace',
    steps: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePending(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    traceId: 'trace-1',
    actionId: 'action-1',
    spanId: 'span-1',
    action: 'notify',
    summary: 'test notify',
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
    } as any,
    projectId: 'proj-1',
    projectPath: '/tmp/test-project',
    trace: makeTrace(),
    owner: 'test-owner',
    repo: 'test-repo',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('resolveChannel', () => {
  it('resolves IssuesEvent to issue comment', () => {
    const spans = [
      makeSpan({
        meta: { type: 'IssuesEvent', issueNumber: 42 },
      }),
    ];
    const channel = resolveChannel(spans, 'owner', 'repo');
    expect(channel).toEqual({ command: 'issue', number: 42 });
  });

  it('resolves PullRequestEvent to pr comment', () => {
    const spans = [
      makeSpan({
        meta: { type: 'PullRequestEvent', prNumber: 99 },
      }),
    ];
    const channel = resolveChannel(spans, 'owner', 'repo');
    expect(channel).toEqual({ command: 'pr', number: 99 });
  });

  it('resolves IssueCommentEvent on an issue', () => {
    const spans = [
      makeSpan({
        meta: {
          type: 'IssueCommentEvent',
          issueNumber: 10,
          isPullRequest: false,
        },
      }),
    ];
    const channel = resolveChannel(spans, 'owner', 'repo');
    expect(channel).toEqual({ command: 'issue', number: 10 });
  });

  it('resolves IssueCommentEvent on a pull request', () => {
    const spans = [
      makeSpan({
        meta: {
          type: 'IssueCommentEvent',
          prNumber: 55,
          isPullRequest: true,
        },
      }),
    ];
    const channel = resolveChannel(spans, 'owner', 'repo');
    expect(channel).toEqual({ command: 'pr', number: 55 });
  });

  it('resolves PullRequestReviewEvent to pr comment', () => {
    const spans = [
      makeSpan({
        meta: { type: 'PullRequestReviewEvent', prNumber: 77 },
      }),
    ];
    const channel = resolveChannel(spans, 'owner', 'repo');
    expect(channel).toEqual({ command: 'pr', number: 77 });
  });

  it('resolves PullRequestReviewCommentEvent to pr comment', () => {
    const spans = [
      makeSpan({
        meta: { type: 'PullRequestReviewCommentEvent', prNumber: 88 },
      }),
    ];
    const channel = resolveChannel(spans, 'owner', 'repo');
    expect(channel).toEqual({ command: 'pr', number: 88 });
  });

  it('returns null for PushEvent', () => {
    const spans = [makeSpan({ meta: { type: 'PushEvent' } })];
    const channel = resolveChannel(spans, 'owner', 'repo');
    expect(channel).toBeNull();
  });

  it('returns null for unknown event types', () => {
    const spans = [makeSpan({ meta: { type: 'UnknownEvent' } })];
    const channel = resolveChannel(spans, 'owner', 'repo');
    expect(channel).toBeNull();
  });

  it('returns null when no root span found', () => {
    const spans = [makeSpan({ parent: 'some-parent' })];
    const channel = resolveChannel(spans, 'owner', 'repo');
    expect(channel).toBeNull();
  });

  it('returns null when issue number is missing', () => {
    const spans = [makeSpan({ meta: { type: 'IssuesEvent' } })];
    const channel = resolveChannel(spans, 'owner', 'repo');
    expect(channel).toBeNull();
  });

  it('finds root span among multiple spans', () => {
    const spans = [
      makeSpan({ id: 'child', parent: 'root-span' }),
      makeSpan({
        id: 'root-span',
        parent: null,
        meta: { type: 'IssuesEvent', issueNumber: 5 },
      }),
    ];
    const channel = resolveChannel(spans, 'owner', 'repo');
    expect(channel).toEqual({ command: 'issue', number: 5 });
  });
});

describe('buildFallbackMessage', () => {
  it('concatenates span summaries', () => {
    const spans = [
      makeSpan({ summary: 'Coordinated: plan' }),
      makeSpan({ summary: 'Planned: 2 tasks' }),
    ];
    const trace = makeTrace({ summary: 'test trace' });

    const message = buildFallbackMessage(spans, trace);
    expect(message).toBe('Coordinated: plan\n\nPlanned: 2 tasks');
  });

  it('returns trace summary when no span summaries', () => {
    const spans = [makeSpan({ summary: null }), makeSpan({ summary: null })];
    const trace = makeTrace({ summary: 'my trace summary' });

    const message = buildFallbackMessage(spans, trace);
    expect(message).toBe('Autopilot finished processing: my trace summary');
  });

  it('filters out null summaries', () => {
    const spans = [
      makeSpan({ summary: 'First' }),
      makeSpan({ summary: null }),
      makeSpan({ summary: 'Third' }),
    ];
    const trace = makeTrace();

    const message = buildFallbackMessage(spans, trace);
    expect(message).toBe('First\n\nThird');
  });
});

describe('notifyStep.process', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spanWriterInstances = [];
  });

  it('posts a comment on an issue when channel is resolved', async () => {
    const rootSpan = makeSpan({
      meta: { type: 'IssuesEvent', issueNumber: 42 },
    });
    const ctx = makeStepContext();
    (ctx.store.getSpanTrace as any).mockReturnValue([rootSpan]);

    mockInvoke.mockResolvedValue(
      JSON.stringify({ message: 'Task completed successfully.' })
    );
    mockLaunch.mockResolvedValue({ failed: false, stdout: '', stderr: '' });

    const pending = makePending({
      meta: { pushed: true, branchesPushed: ['feat/test'] },
    });

    const result = await notifyStep.process(pending, ctx);

    expect(result.terminal).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.reasoning).toContain('commented on issue #42');
    expect(mockLaunch).toHaveBeenCalledWith(
      'gh',
      ['issue', 'comment', '42', '--body', 'Task completed successfully.'],
      { env: { GH_REPO: 'test-owner/test-repo' } }
    );
    expect(ctx.store.removePending).toHaveBeenCalledWith('action-1');
  });

  it('returns terminal with no channel for PushEvent', async () => {
    const rootSpan = makeSpan({ meta: { type: 'PushEvent' } });
    const ctx = makeStepContext();
    (ctx.store.getSpanTrace as any).mockReturnValue([rootSpan]);

    mockInvoke.mockResolvedValue(JSON.stringify({ message: 'Done.' }));

    const result = await notifyStep.process(makePending(), ctx);

    expect(result.terminal).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.reasoning).toBe('no comment target');
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('uses fallback message when AI fails', async () => {
    const rootSpan = makeSpan({
      summary: 'Coordinated task',
      meta: { type: 'IssuesEvent', issueNumber: 1 },
    });
    const ctx = makeStepContext();
    (ctx.store.getSpanTrace as any).mockReturnValue([rootSpan]);

    mockInvoke.mockRejectedValue(new Error('AI unavailable'));
    mockLaunch.mockResolvedValue({ failed: false, stdout: '', stderr: '' });

    const result = await notifyStep.process(makePending(), ctx);

    expect(result.terminal).toBe(true);
    // The fallback message should have been posted
    expect(mockLaunch).toHaveBeenCalledWith(
      'gh',
      ['issue', 'comment', '1', '--body', 'Coordinated task'],
      expect.any(Object)
    );
  });

  it('marks span as failed when comment delivery fails', async () => {
    const rootSpan = makeSpan({
      meta: { type: 'PullRequestEvent', prNumber: 10 },
    });
    const ctx = makeStepContext();
    (ctx.store.getSpanTrace as any).mockReturnValue([rootSpan]);

    mockInvoke.mockResolvedValue(JSON.stringify({ message: 'Comment body' }));
    mockLaunch.mockResolvedValue({
      failed: true,
      stdout: '',
      stderr: Buffer.from('permission denied'),
    });

    const result = await notifyStep.process(makePending(), ctx);

    expect(result.terminal).toBe(true);
    expect(result.status).toBe('failed');
    expect(result.reasoning).toContain('failed to comment');

    // The span should have been created and failed
    const span = spanWriterInstances[0];
    expect(span.fail).toHaveBeenCalled();
  });

  it('passes clarify context through to AI', async () => {
    const rootSpan = makeSpan({
      meta: { type: 'IssuesEvent', issueNumber: 3 },
    });
    const ctx = makeStepContext();
    (ctx.store.getSpanTrace as any).mockReturnValue([rootSpan]);

    mockInvoke.mockResolvedValue(
      JSON.stringify({
        message: 'Could you clarify the expected behavior?',
      })
    );
    mockLaunch.mockResolvedValue({ failed: false, stdout: '', stderr: '' });

    const pending = makePending({
      meta: {
        originalAction: 'clarify',
        questions: ['What is the expected output format?'],
      },
    });

    const result = await notifyStep.process(pending, ctx);

    expect(result.terminal).toBe(true);
    expect(result.status).toBe('completed');

    // Verify AI was called with the clarify context
    const aiCallArgs = mockInvoke.mock.calls[0][0] as string;
    expect(aiCallArgs).toContain('originalAction');
    expect(aiCallArgs).toContain('clarify');
  });

  it('handles missing owner/repo gracefully', async () => {
    const rootSpan = makeSpan({
      meta: { type: 'IssuesEvent', issueNumber: 5 },
    });
    const ctx = makeStepContext({ owner: undefined, repo: undefined });
    (ctx.store.getSpanTrace as any).mockReturnValue([rootSpan]);

    mockInvoke.mockResolvedValue(JSON.stringify({ message: 'Done.' }));

    const result = await notifyStep.process(makePending(), ctx);

    expect(result.terminal).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.reasoning).toBe('no comment target');
    expect(mockLaunch).not.toHaveBeenCalled();
  });
});
