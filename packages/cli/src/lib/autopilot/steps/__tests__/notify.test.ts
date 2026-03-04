import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Span, ActionTrace, PendingAction } from '../../types.js';
import {
  resolveChannel,
  buildFallbackMessage,
  buildRoverFooter,
  notifyStep,
} from '../notify.js';
import { ROVER_FOOTER_MARKER } from '../../constants.js';
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

// Mock AI helper
const mockInvokeAI = vi.fn();
vi.mock('../ai.js', () => ({
  invokeAI: (...args: any[]) => mockInvokeAI(...args),
  appendPromptSuffix: (prompt: string) => prompt,
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

    mockInvokeAI.mockResolvedValue({
      notify: true,
      message: 'Task completed successfully.',
      reasoning: 'User needs to know',
    });
    mockLaunch.mockResolvedValue({ failed: false, stdout: '', stderr: '' });

    const pending = makePending({
      meta: { pushed: true, branchesPushed: ['feat/test'] },
    });

    const result = await notifyStep.process(pending, ctx);

    expect(result.terminal).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.reasoning).toContain('commented on issue #42');
    // The posted message should include the Rover footer
    const postedBody = mockLaunch.mock.calls[0][1][4] as string;
    expect(postedBody).toContain('Task completed successfully.');
    expect(postedBody).toContain(ROVER_FOOTER_MARKER);
    expect(mockLaunch).toHaveBeenCalledWith(
      'gh',
      ['issue', 'comment', '42', '--body', postedBody],
      { env: { GH_REPO: 'test-owner/test-repo' } }
    );
    expect(ctx.store.removePending).toHaveBeenCalledWith('action-1');
  });

  it('returns terminal with no channel for PushEvent', async () => {
    const rootSpan = makeSpan({ meta: { type: 'PushEvent' } });
    const ctx = makeStepContext();
    (ctx.store.getSpanTrace as any).mockReturnValue([rootSpan]);

    mockInvokeAI.mockResolvedValue({
      notify: true,
      message: 'Done.',
      reasoning: 'informational',
    });

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

    mockInvokeAI.mockRejectedValue(new Error('AI unavailable'));
    mockLaunch.mockResolvedValue({ failed: false, stdout: '', stderr: '' });

    const result = await notifyStep.process(makePending(), ctx);

    expect(result.terminal).toBe(true);
    // The fallback message should have been posted (with footer appended)
    const fallbackBody = mockLaunch.mock.calls[0][1][4] as string;
    expect(fallbackBody).toContain('Coordinated task');
    expect(fallbackBody).toContain(ROVER_FOOTER_MARKER);
  });

  it('marks span as failed when comment delivery fails', async () => {
    const rootSpan = makeSpan({
      meta: { type: 'PullRequestEvent', prNumber: 10 },
    });
    const ctx = makeStepContext();
    (ctx.store.getSpanTrace as any).mockReturnValue([rootSpan]);

    mockInvokeAI.mockResolvedValue({
      notify: true,
      message: 'Comment body',
      reasoning: 'failure needs reporting',
    });
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

    mockInvokeAI.mockResolvedValue({
      notify: true,
      message: 'Could you clarify the expected behavior?',
      reasoning: 'clarification needed from user',
    });
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
    const aiCallArgs = mockInvokeAI.mock.calls[0][0].userMessage as string;
    expect(aiCallArgs).toContain('originalAction');
    expect(aiCallArgs).toContain('clarify');
  });

  it('handles missing owner/repo gracefully', async () => {
    const rootSpan = makeSpan({
      meta: { type: 'IssuesEvent', issueNumber: 5 },
    });
    const ctx = makeStepContext({ owner: undefined, repo: undefined });
    (ctx.store.getSpanTrace as any).mockReturnValue([rootSpan]);

    mockInvokeAI.mockResolvedValue({
      notify: true,
      message: 'Done.',
      reasoning: 'informational',
    });

    const result = await notifyStep.process(makePending(), ctx);

    expect(result.terminal).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.reasoning).toBe('no comment target');
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('skips posting when AI decides notification is not needed', async () => {
    const rootSpan = makeSpan({
      meta: { type: 'IssuesEvent', issueNumber: 7 },
    });
    const ctx = makeStepContext();
    (ctx.store.getSpanTrace as any).mockReturnValue([rootSpan]);

    mockInvokeAI.mockResolvedValue({
      notify: false,
      message: '',
      reasoning: 'PR was created and is already linked on the issue',
    });

    const pending = makePending({
      meta: {
        pushed: true,
        pullRequestUrl: 'https://github.com/o/r/pull/1',
      },
    });

    const result = await notifyStep.process(pending, ctx);

    expect(result.terminal).toBe(true);
    expect(result.status).toBeUndefined(); // defaults to 'completed'
    expect(result.reasoning).toContain('skipped');
    expect(result.reasoning).toContain('PR was created');
    expect(mockLaunch).not.toHaveBeenCalled();

    const span = spanWriterInstances[0];
    expect(span.complete).toHaveBeenCalled();
    expect(span.meta.skipped).toBe(true);
  });
});

describe('notifyStep.process — assistant mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spanWriterInstances = [];
  });

  it('still invokes AI for message composition', async () => {
    const rootSpan = makeSpan({
      meta: { type: 'IssuesEvent', issueNumber: 42 },
    });
    const ctx = makeStepContext({ mode: 'assistant' });
    (ctx.store.getSpanTrace as any).mockReturnValue([rootSpan]);

    mockInvokeAI.mockResolvedValue({
      notify: true,
      message: 'Task completed.',
      reasoning: 'notify user',
    });

    await notifyStep.process(makePending(), ctx);

    expect(mockInvokeAI).toHaveBeenCalled();
  });

  it('does not post comments (launch not called for posting)', async () => {
    const rootSpan = makeSpan({
      meta: { type: 'IssuesEvent', issueNumber: 42 },
    });
    const ctx = makeStepContext({ mode: 'assistant' });
    (ctx.store.getSpanTrace as any).mockReturnValue([rootSpan]);

    mockInvokeAI.mockResolvedValue({
      notify: true,
      message: 'Done.',
      reasoning: 'informational',
    });

    await notifyStep.process(makePending(), ctx);

    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('creates span with dryRun metadata and commands', async () => {
    const rootSpan = makeSpan({
      meta: { type: 'IssuesEvent', issueNumber: 42 },
    });
    const ctx = makeStepContext({ mode: 'assistant' });
    (ctx.store.getSpanTrace as any).mockReturnValue([rootSpan]);

    mockInvokeAI.mockResolvedValue({
      notify: true,
      message: 'Task completed.',
      reasoning: 'notify user',
    });

    await notifyStep.process(makePending(), ctx);

    const span = spanWriterInstances[0];
    expect(span.meta.dryRun).toBe(true);
    expect(span.meta.commands).toBeInstanceOf(Array);
    expect(span.complete).toHaveBeenCalled();
  });

  it('generates gh comment command for issue channel', async () => {
    const rootSpan = makeSpan({
      meta: { type: 'IssuesEvent', issueNumber: 42 },
    });
    const ctx = makeStepContext({ mode: 'assistant' });
    (ctx.store.getSpanTrace as any).mockReturnValue([rootSpan]);

    mockInvokeAI.mockResolvedValue({
      notify: true,
      message: 'Done.',
      reasoning: 'informational',
    });

    await notifyStep.process(makePending(), ctx);

    const span = spanWriterInstances[0];
    const commands = span.meta.commands as string[];
    expect(
      commands.some(
        (c: string) =>
          c.includes('gh issue comment 42') &&
          c.includes('--repo test-owner/test-repo')
      )
    ).toBe(true);
  });

  it('returns terminal: true with empty enqueuedActions', async () => {
    const rootSpan = makeSpan({
      meta: { type: 'IssuesEvent', issueNumber: 10 },
    });
    const ctx = makeStepContext({ mode: 'assistant' });
    (ctx.store.getSpanTrace as any).mockReturnValue([rootSpan]);

    mockInvokeAI.mockResolvedValue({
      notify: true,
      message: 'Done.',
      reasoning: 'informational',
    });

    const result = await notifyStep.process(makePending(), ctx);

    expect(result.terminal).toBe(true);
    expect(result.enqueuedActions).toEqual([]);
  });

  it('handles AI deciding not to notify in assistant mode', async () => {
    const rootSpan = makeSpan({
      meta: { type: 'IssuesEvent', issueNumber: 7 },
    });
    const ctx = makeStepContext({ mode: 'assistant' });
    (ctx.store.getSpanTrace as any).mockReturnValue([rootSpan]);

    mockInvokeAI.mockResolvedValue({
      notify: false,
      message: '',
      reasoning: 'not needed',
    });

    const result = await notifyStep.process(makePending(), ctx);

    // When AI says don't notify, the existing skip logic runs (not dry-run)
    expect(result.terminal).toBe(true);
    expect(result.reasoning).toContain('skipped');
    expect(mockLaunch).not.toHaveBeenCalled();
  });
});

describe('buildRoverFooter', () => {
  it('includes the footer marker', () => {
    const footer = buildRoverFooter('trace-abc', 'action-xyz');
    expect(footer).toContain(ROVER_FOOTER_MARKER);
  });

  it('includes trace and action IDs', () => {
    const footer = buildRoverFooter('trace-abc', 'action-xyz');
    expect(footer).toContain('`trace-abc`');
    expect(footer).toContain('`action-xyz`');
  });

  it('wraps content in details tags', () => {
    const footer = buildRoverFooter('t1', 'a1');
    expect(footer).toContain('<details>');
    expect(footer).toContain('</details>');
  });
});
