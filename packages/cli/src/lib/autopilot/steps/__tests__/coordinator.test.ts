import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let projectDir: string;

vi.mock('rover-core', async () => {
  const actual =
    await vi.importActual<typeof import('rover-core')>('rover-core');
  return {
    ...actual,
    getProjectPath: () => projectDir,
  };
});

const mockInvoke = vi.fn();

vi.mock('@endorhq/agent', () => ({
  ACPProvider: {
    fromProject: () => ({ invoke: mockInvoke }),
  },
  parseJsonResponse: <T>(raw: string): T | null => {
    try {
      // Strip markdown code fences if present
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      return JSON.parse(cleaned) as T;
    } catch {
      return null;
    }
  },
}));

import { AutopilotStore } from '../../store.js';
import type { Action, PendingAction, TraceItem } from '../../types.js';
import { coordinatorStep, buildCoordinatorPrompt } from '../coordinator.js';
import type { StepContext } from '../types.js';

function makePending(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    traceId: 'trace-1',
    actionId: 'action-1',
    action: 'coordinate',
    ...overrides,
  };
}

function writeActionFile(
  actionId: string,
  overrides: Partial<Action> = {}
): void {
  const data: Action = {
    id: actionId,
    version: '1.0',
    action: 'coordinate',
    timestamp: new Date().toISOString(),
    spanId: 'parent-span-1',
    meta: { event: { type: 'issue', number: 42 } },
    reasoning: 'New issue opened',
    ...overrides,
  };
  writeFileSync(
    join(projectDir, 'actions', `${actionId}.json`),
    JSON.stringify(data)
  );
}

function makeTrace(): TraceItem {
  return {
    traceId: 'trace-1',
    summary: 'Test trace',
    spanIds: [],
    nextActions: ['action-1'],
    createdAt: new Date().toISOString(),
  };
}

function makeContext(store: AutopilotStore): StepContext {
  return {
    store,
    projectId: 'test-project',
    projectPath: projectDir,
    owner: 'test-owner',
    repo: 'test-repo',
    project: undefined,
    workflowStore: undefined,
    memoryStore: undefined,
    botName: 'rover-bot',
    maintainers: undefined,
    customInstructions: undefined,
    mode: undefined,
    trace: makeTrace(),
    failTrace: vi.fn(),
  };
}

function makeDecisionResponse(overrides: Record<string, unknown> = {}): {
  response: string;
} {
  return {
    response: JSON.stringify({
      action: 'plan',
      confidence: 'high',
      reasoning: 'This issue needs investigation.',
      context: 'Issue #42 opened with feature request.',
      meta: { scope: 'feature request', references: ['#42'] },
      ...overrides,
    }),
  };
}

describe('coordinatorStep', () => {
  let store: AutopilotStore;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'coordinator-test-'));
    mkdirSync(join(projectDir, 'spans'), { recursive: true });
    mkdirSync(join(projectDir, 'actions'), { recursive: true });
    store = new AutopilotStore('test-project');
    store.ensureDir();

    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(makeDecisionResponse());
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('has correct config', () => {
    expect(coordinatorStep.config.actionType).toBe('coordinate');
    expect(coordinatorStep.config.maxParallel).toBe(3);
  });

  it('processes a coordinate action and returns plan decision', async () => {
    const pending = makePending();
    writeActionFile('action-1');
    store.addPending(pending);

    const ctx = makeContext(store);
    const result = await coordinatorStep.process(pending, ctx);

    expect(result.spanId).toBeDefined();
    expect(result.terminal).toBe(false);
    expect(result.newActions).toHaveLength(1);
    expect(result.newActions?.[0].action).toBe('plan');
  });

  it('fails trace on unknown action', async () => {
    mockInvoke.mockResolvedValue(
      makeDecisionResponse({ action: 'unknown_action' })
    );

    const pending = makePending();
    writeActionFile('action-1');
    store.addPending(pending);

    const ctx = makeContext(store);
    const result = await coordinatorStep.process(pending, ctx);

    expect(result.terminal).toBe(true);
    expect(result.newActions).toBeUndefined();
    expect(ctx.failTrace).toHaveBeenCalled();

    // Span should be marked as failed with reason
    const spanData = JSON.parse(
      require('node:fs').readFileSync(
        join(projectDir, 'spans', `${result.spanId}.json`),
        'utf8'
      )
    );
    expect(spanData.status).toBe('failed');
    expect(spanData.summary).toContain('unknown_action');
  });

  it('fails trace on recursive coordinate action', async () => {
    mockInvoke.mockResolvedValue(
      makeDecisionResponse({ action: 'coordinate' })
    );

    const pending = makePending();
    writeActionFile('action-1');
    store.addPending(pending);

    const ctx = makeContext(store);
    const result = await coordinatorStep.process(pending, ctx);

    expect(result.terminal).toBe(true);
    expect(result.newActions).toBeUndefined();
    expect(ctx.failTrace).toHaveBeenCalled();

    // Span should be marked as failed
    const spanData = JSON.parse(
      require('node:fs').readFileSync(
        join(projectDir, 'spans', `${result.spanId}.json`),
        'utf8'
      )
    );
    expect(spanData.status).toBe('failed');
    expect(spanData.summary).toContain('Recursive');
    expect(spanData.summary).toContain('Original reasoning:');
  });

  it('removes satisfied wait entry', async () => {
    const waitEntry = {
      traceId: 'trace-1',
      actionId: 'wait-action-1',
      spanId: 'wait-span-1',
      waitingFor: 'CI to pass',
      resumeAction: 'plan',
      resumeMeta: {},
      eventSummary: 'PR opened',
      createdAt: new Date().toISOString(),
    };
    store.addWaitEntry(waitEntry);

    mockInvoke.mockResolvedValue(
      makeDecisionResponse({
        action: 'plan',
        meta: { satisfied_wait_id: 'wait-action-1' },
      })
    );

    const pending = makePending();
    writeActionFile('action-1');

    const ctx = makeContext(store);
    await coordinatorStep.process(pending, ctx);

    expect(store.getWaitQueue()).toHaveLength(0);
  });

  it('includes wait queue context in user message', async () => {
    const waitEntry = {
      traceId: 'trace-1',
      actionId: 'wait-action-1',
      spanId: 'wait-span-1',
      waitingFor: 'Review approval',
      resumeAction: 'workflow',
      resumeMeta: {},
      eventSummary: 'PR #15 review requested',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    store.addWaitEntry(waitEntry);

    const pending = makePending();
    writeActionFile('action-1');

    const ctx = makeContext(store);
    await coordinatorStep.process(pending, ctx);

    const invokeCall = mockInvoke.mock.calls[0];
    const userMessage = invokeCall[0] as string;
    expect(userMessage).toContain('Waiting Queue');
    expect(userMessage).toContain('Review approval');
    expect(userMessage).toContain('wait-action-1');
  });

  it('handles missing action data gracefully', async () => {
    // Don't write the action file — readAction will return null
    const pending = makePending({ actionId: 'nonexistent-action' });

    const ctx = makeContext(store);
    const result = await coordinatorStep.process(pending, ctx);

    expect(result.spanId).toBeDefined();
    expect(result.newActions).toHaveLength(1);
  });

  it('creates and completes a span', async () => {
    const pending = makePending();
    writeActionFile('action-1');

    const ctx = makeContext(store);
    const result = await coordinatorStep.process(pending, ctx);

    // Verify span was written to disk
    const spanPath = join(projectDir, 'spans', `${result.spanId}.json`);
    const span = JSON.parse(require('node:fs').readFileSync(spanPath, 'utf8'));
    expect(span.step).toBe('coordinate');
    expect(span.status).toBe('completed');
    expect(span.originAction).toBe('action-1');
  });

  it('marks span as error on failure', async () => {
    mockInvoke.mockRejectedValue(new Error('AI service unavailable'));

    const pending = makePending();
    writeActionFile('action-1');

    const ctx = makeContext(store);
    await expect(coordinatorStep.process(pending, ctx)).rejects.toThrow(
      'AI service unavailable'
    );

    // Find the span file (we don't know the ID, but there should be one)
    const fs = require('node:fs');
    const spanFiles = fs.readdirSync(join(projectDir, 'spans'));
    expect(spanFiles.length).toBeGreaterThan(0);

    const span = JSON.parse(
      fs.readFileSync(join(projectDir, 'spans', spanFiles[0]), 'utf8')
    );
    expect(span.status).toBe('error');
    expect(span.summary).toContain('AI service unavailable');
  });

  it('passes systemPrompt to AI provider', async () => {
    const pending = makePending();
    writeActionFile('action-1');

    const ctx = makeContext(store);
    await coordinatorStep.process(pending, ctx);

    const invokeCall = mockInvoke.mock.calls[0];
    const options = invokeCall[1] as Record<string, unknown>;
    expect(options.systemPrompt).toBeDefined();
    expect(typeof options.systemPrompt).toBe('string');
    expect(options.json).toBe(true);
  });

  it('filters wait queue by traceId', async () => {
    store.addWaitEntry({
      traceId: 'trace-1',
      actionId: 'same-trace-wait',
      spanId: 's1',
      waitingFor: 'Same trace condition',
      resumeAction: 'plan',
      resumeMeta: {},
      eventSummary: 'Same trace event',
      createdAt: new Date().toISOString(),
    });
    store.addWaitEntry({
      traceId: 'other-trace',
      actionId: 'other-trace-wait',
      spanId: 's2',
      waitingFor: 'Other trace condition',
      resumeAction: 'plan',
      resumeMeta: {},
      eventSummary: 'Other trace event',
      createdAt: new Date().toISOString(),
    });

    const pending = makePending();
    writeActionFile('action-1');

    const ctx = makeContext(store);
    await coordinatorStep.process(pending, ctx);

    const userMessage = mockInvoke.mock.calls[0][0] as string;
    expect(userMessage).toContain('Same trace condition');
    expect(userMessage).not.toContain('Other trace condition');
  });
});

describe('buildCoordinatorPrompt', () => {
  it('includes anti-recursion constraint', () => {
    const prompt = buildCoordinatorPrompt({});
    expect(prompt).toContain(
      'The `coordinate` action is NOT available for this decision'
    );
  });

  it('injects bot name and memory collection', () => {
    const prompt = buildCoordinatorPrompt({
      botName: 'my-bot',
      memoryCollection: 'my-memory',
    });
    expect(prompt).toContain('my-bot');
    expect(prompt).toContain('my-memory');
  });

  it('uses defaults for missing values', () => {
    const prompt = buildCoordinatorPrompt({});
    expect(prompt).toContain('the bot account');
    expect(prompt).toContain('rover-memory');
  });

  it('injects workflow catalog from workflowStore', () => {
    const mockStore = {
      getAllWorkflowEntries: () => [
        {
          workflow: {
            name: 'deploy',
            description: 'Deploy to production',
            inputs: [],
            outputs: [],
            steps: [],
          },
          source: 'project',
        },
      ],
    } as unknown as import('rover-core').WorkflowStore;

    const prompt = buildCoordinatorPrompt({ workflowStore: mockStore });
    expect(prompt).toContain('### `deploy` — Deploy to production');
  });
});
