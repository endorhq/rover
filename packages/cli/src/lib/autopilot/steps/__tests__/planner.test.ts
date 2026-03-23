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
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      return JSON.parse(cleaned) as T;
    } catch {
      return null;
    }
  },
}));

import type { ProjectManager } from 'rover-core';
import { AutopilotStore } from '../../store.js';
import type { Action, PendingAction, Span, TraceItem } from '../../types.js';
import { plannerStep } from '../planner.js';
import type { StepContext } from '../types.js';

function makePending(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    traceId: 'trace-1',
    actionId: 'action-1',
    action: 'plan',
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
    action: 'plan',
    timestamp: new Date().toISOString(),
    spanId: 'parent-span-1',
    meta: {
      scope: 'implement feature X',
      constraints: ['keep backward compat'],
    },
    reasoning: 'New plan directive',
    ...overrides,
  };
  writeFileSync(
    join(projectDir, 'actions', `${actionId}.json`),
    JSON.stringify(data)
  );
}

function writeSpanFile(spanId: string, overrides: Partial<Span> = {}): void {
  const data: Span = {
    id: spanId,
    version: '1.0',
    timestamp: new Date().toISOString(),
    step: 'coordinate',
    parent: null,
    status: 'completed',
    completed: new Date().toISOString(),
    summary: 'coordinate: plan — New issue opened',
    meta: { action: 'plan', scope: 'implement feature X' },
    originAction: null,
    newActions: [],
    ...overrides,
  };
  writeFileSync(
    join(projectDir, 'spans', `${spanId}.json`),
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

const mockWorkflowStore = {
  getWorkflow: vi.fn((name: string) =>
    name === 'swe' || name === 'code-review'
      ? {
          name,
          description: `${name} workflow`,
          inputs: [],
          outputs: [],
          steps: [],
        }
      : undefined
  ),
  getAllWorkflowEntries: () => [],
} as unknown as import('rover-core').WorkflowStore;

function makeContext(
  store: AutopilotStore,
  overrides: Partial<StepContext> = {}
): StepContext {
  return {
    store,
    project: {
      id: 'test-project',
      path: projectDir,
    } as unknown as ProjectManager,
    owner: 'test-owner',
    repo: 'test-repo',
    workflowStore: mockWorkflowStore,
    memoryStore: undefined,
    botName: 'rover-bot',
    maintainers: undefined,
    customInstructions: undefined,
    mode: undefined,
    trace: makeTrace(),
    failTrace: vi.fn(),
    ...overrides,
  };
}

function makePlanResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    analysis: 'Found relevant files in src/lib.',
    tasks: [
      {
        title: 'Implement feature X',
        workflow: 'swe',
        acceptance_criteria: ['Tests pass', 'Feature works'],
        inputs: { description: 'Implement feature X in the codebase' },
        context_uris: [],
        context: {
          files: ['src/lib/feature.ts'],
          references: ['#42'],
          depends_on: null,
        },
      },
    ],
    execution_order: 'parallel',
    reasoning: 'Single task since all changes are in one subsystem.',
    ...overrides,
  });
}

describe('plannerStep', () => {
  let store: AutopilotStore;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'planner-test-'));
    mkdirSync(join(projectDir, 'spans'), { recursive: true });
    mkdirSync(join(projectDir, 'actions'), { recursive: true });
    store = new AutopilotStore('test-project');
    store.ensureDir();

    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ response: makePlanResponse() });
    (
      mockWorkflowStore.getWorkflow as ReturnType<typeof vi.fn>
    ).mockImplementation((name: string) =>
      name === 'swe' || name === 'code-review'
        ? {
            name,
            description: `${name} workflow`,
            inputs: [],
            outputs: [],
            steps: [],
          }
        : undefined
    );
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('has correct config', () => {
    expect(plannerStep.config.actionType).toBe('plan');
    expect(plannerStep.config.maxParallel).toBe(2);
  });

  it('processes a plan action and returns workflow actions', async () => {
    mockInvoke.mockResolvedValue({
      response: makePlanResponse({
        tasks: [
          {
            title: 'Implement feature X',
            workflow: 'swe',
            acceptance_criteria: ['Tests pass'],
            inputs: { description: 'Implement feature X' },
            context: { files: [], references: [], depends_on: null },
          },
          {
            title: 'Review changes',
            workflow: 'code-review',
            acceptance_criteria: ['Review complete'],
            inputs: { description: 'Review the implementation' },
            context: { files: [], references: [], depends_on: null },
          },
        ],
      }),
    });

    const pending = makePending();
    writeActionFile('action-1');
    store.addPending(pending);

    const ctx = makeContext(store);
    const result = await plannerStep.process(pending, ctx);

    expect(result.spanId).toBeDefined();
    expect(result.terminal).toBe(false);
    expect(result.newActions).toHaveLength(2);
    expect(result.newActions?.[0].action).toBe('workflow');
    expect(result.newActions?.[1].action).toBe('workflow');
  });

  it('creates noop action when plan has no tasks', async () => {
    mockInvoke.mockResolvedValue({
      response: makePlanResponse({
        tasks: [],
        reasoning: 'No changes needed for this event.',
      }),
    });

    const pending = makePending();
    writeActionFile('action-1');

    const ctx = makeContext(store);
    const result = await plannerStep.process(pending, ctx);

    expect(result.terminal).toBe(false);
    expect(result.newActions).toHaveLength(1);
    expect(result.newActions?.[0].action).toBe('noop');

    const fs = require('node:fs');
    const spanData = JSON.parse(
      fs.readFileSync(
        join(projectDir, 'spans', `${result.spanId}.json`),
        'utf8'
      )
    );
    expect(spanData.status).toBe('completed');
    expect(spanData.summary).toContain('noop');

    // Verify the noop action file was written
    const noopPath = join(
      projectDir,
      'actions',
      `${result.newActions?.[0].actionId}.json`
    );
    const noopData = JSON.parse(fs.readFileSync(noopPath, 'utf8'));
    expect(noopData.action).toBe('noop');
    expect(noopData.reasoning).toBe('No changes needed for this event.');
  });

  it('fails trace on invalid workflow type', async () => {
    mockInvoke.mockResolvedValue({
      response: makePlanResponse({
        tasks: [
          {
            title: 'Bad task',
            workflow: 'nonexistent-workflow',
            acceptance_criteria: [],
            inputs: { description: 'Bad' },
            context: { files: [], references: [], depends_on: null },
          },
        ],
      }),
    });

    const pending = makePending();
    writeActionFile('action-1');

    const ctx = makeContext(store);
    const result = await plannerStep.process(pending, ctx);

    expect(result.terminal).toBe(true);
    expect(result.newActions).toBeUndefined();
    expect(ctx.failTrace).toHaveBeenCalledWith(
      'Invalid workflow type: nonexistent-workflow'
    );

    const fs = require('node:fs');
    const spanData = JSON.parse(
      fs.readFileSync(
        join(projectDir, 'spans', `${result.spanId}.json`),
        'utf8'
      )
    );
    expect(spanData.status).toBe('failed');
  });

  it('creates and completes a span', async () => {
    const pending = makePending();
    writeActionFile('action-1');

    const ctx = makeContext(store);
    const result = await plannerStep.process(pending, ctx);

    const spanPath = join(projectDir, 'spans', `${result.spanId}.json`);
    const span = JSON.parse(require('node:fs').readFileSync(spanPath, 'utf8'));
    expect(span.step).toBe('plan');
    expect(span.status).toBe('completed');
    expect(span.originAction).toBe('action-1');
  });

  it('marks span as error on failure', async () => {
    mockInvoke.mockRejectedValue(new Error('AI service unavailable'));

    const pending = makePending();
    writeActionFile('action-1');

    const ctx = makeContext(store);
    await expect(plannerStep.process(pending, ctx)).rejects.toThrow(
      'AI service unavailable'
    );

    const fs = require('node:fs');
    const spanFiles = fs.readdirSync(join(projectDir, 'spans'));
    expect(spanFiles.length).toBeGreaterThan(0);

    // Find the span created by the planner (step: 'plan')
    const planSpan = spanFiles
      .map((f: string) =>
        JSON.parse(fs.readFileSync(join(projectDir, 'spans', f), 'utf8'))
      )
      .find((s: Record<string, unknown>) => s.step === 'plan');

    expect(planSpan).toBeDefined();
    expect(planSpan.status).toBe('error');
    expect(planSpan.summary).toContain('AI service unavailable');
  });

  it('passes systemPrompt to AI provider', async () => {
    const pending = makePending();
    writeActionFile('action-1');

    const ctx = makeContext(store);
    await plannerStep.process(pending, ctx);

    const invokeCall = mockInvoke.mock.calls[0];
    const options = invokeCall[1] as Record<string, unknown>;
    expect(options.systemPrompt).toBeDefined();
    expect(typeof options.systemPrompt).toBe('string');
    expect(options.json).toBe(true);
  });

  it('handles missing action data gracefully', async () => {
    const pending = makePending({ actionId: 'nonexistent-action' });

    const ctx = makeContext(store);
    const result = await plannerStep.process(pending, ctx);

    expect(result.spanId).toBeDefined();
    expect(result.newActions).toHaveLength(1);
  });

  it('builds user message with span trace context', async () => {
    writeSpanFile('parent-span-1');
    writeActionFile('action-1');

    const pending = makePending();
    const ctx = makeContext(store);
    await plannerStep.process(pending, ctx);

    const userMessage = mockInvoke.mock.calls[0][0] as string;
    expect(userMessage).toContain('Plan Directive');
    expect(userMessage).toContain('implement feature X');
    expect(userMessage).toContain('Spans');
    expect(userMessage).toContain('coordinate');
  });

  it('creates action files on disk for each task', async () => {
    mockInvoke.mockResolvedValue({
      response: makePlanResponse({
        tasks: [
          {
            title: 'Task A',
            workflow: 'swe',
            acceptance_criteria: ['Done'],
            inputs: { description: 'Do task A' },
            context: { files: [], references: [], depends_on: null },
          },
          {
            title: 'Task B',
            workflow: 'swe',
            acceptance_criteria: ['Done'],
            inputs: { description: 'Do task B' },
            context: { files: [], references: [], depends_on: null },
          },
        ],
      }),
    });

    const pending = makePending();
    writeActionFile('action-1');

    const ctx = makeContext(store);
    const result = await plannerStep.process(pending, ctx);

    const fs = require('node:fs');
    const actionFiles = fs.readdirSync(join(projectDir, 'actions'));
    // Original action file + 2 new workflow action files
    expect(actionFiles.length).toBeGreaterThanOrEqual(3);

    // Verify the new actions are workflow actions
    for (const newAction of result.newActions ?? []) {
      const actionPath = join(
        projectDir,
        'actions',
        `${newAction.actionId}.json`
      );
      const actionData = JSON.parse(fs.readFileSync(actionPath, 'utf8'));
      expect(actionData.action).toBe('workflow');
    }
  });

  it('resolves depends_on titles to action IDs', async () => {
    mockInvoke.mockResolvedValue({
      response: makePlanResponse({
        tasks: [
          {
            title: 'Find the bug',
            workflow: 'swe',
            acceptance_criteria: ['Bug found'],
            inputs: { description: 'Investigate the bug' },
            context: { files: [], references: [], depends_on: null },
          },
          {
            title: 'Fix the bug',
            workflow: 'swe',
            acceptance_criteria: ['Bug fixed'],
            inputs: { description: 'Fix the identified bug' },
            context: { files: [], references: [], depends_on: 'Find the bug' },
          },
        ],
      }),
    });

    const pending = makePending();
    writeActionFile('action-1');

    const ctx = makeContext(store);
    const result = await plannerStep.process(pending, ctx);

    expect(result.newActions).toHaveLength(2);

    const fs = require('node:fs');
    const firstActionId = result.newActions?.[0].actionId;
    const secondActionPath = join(
      projectDir,
      'actions',
      `${result.newActions?.[1].actionId}.json`
    );
    const secondAction = JSON.parse(fs.readFileSync(secondActionPath, 'utf8'));
    expect(secondAction.meta.depends_on).toBe(firstActionId);
  });
});
