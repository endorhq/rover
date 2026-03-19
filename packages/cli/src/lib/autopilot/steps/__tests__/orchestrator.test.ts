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

import { AutopilotStore } from '../../store.js';
import type { Action, TraceItem, PendingAction } from '../../types.js';
import { StepOrchestrator } from '../orchestrator.js';
import type {
  OrchestratorCallbacks,
  Step,
  StepResult,
  StepStatus,
} from '../types.js';

function makePending(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    traceId: 'trace-1',
    actionId: overrides.actionId ?? 'action-1',
    action: 'coordinate',
    ...overrides,
  };
}

function writeActionFile(actionId: string, overrides: Partial<Action> = {}) {
  const data: Action = {
    id: actionId,
    version: '1.0',
    action: 'coordinate',
    timestamp: new Date().toISOString(),
    spanId: 'span-1',
    meta: {},
    reasoning: 'test action',
    ...overrides,
  };
  writeFileSync(
    join(projectDir, 'actions', `${actionId}.json`),
    JSON.stringify(data)
  );
}

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    config: {
      actionType: 'coordinate',
      maxParallel: 5,
      ...overrides.config,
    },
    process: vi.fn().mockResolvedValue({
      spanId: 'result-span-1',
    } satisfies StepResult),
    ...overrides,
  };
}

function makeCallbacks(): OrchestratorCallbacks & {
  tracesUpdated: number;
  statusChanges: Array<{ actionType: string; status: StepStatus }>;
} {
  const cb = {
    tracesUpdated: 0,
    statusChanges: [] as Array<{ actionType: string; status: StepStatus }>,
    onTracesUpdated() {
      cb.tracesUpdated++;
    },
    onStatusChanged(actionType: string, status: StepStatus) {
      cb.statusChanges.push({ actionType, status });
    },
  };
  return cb;
}

function createOrchestrator(
  store: AutopilotStore,
  steps: Step[],
  callbacks: OrchestratorCallbacks,
  traces?: Map<string, TraceItem>
) {
  return new StepOrchestrator({
    steps,
    store,
    traces: traces ?? new Map(),
    projectId: 'test-project',
    projectPath: projectDir,
    callbacks,
    fallbackIntervalMs: 60_000, // Long interval so tests control drains
  });
}

describe('StepOrchestrator', () => {
  let store: AutopilotStore;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'orchestrator-test-'));
    mkdirSync(join(projectDir, 'spans'), { recursive: true });
    mkdirSync(join(projectDir, 'actions'), { recursive: true });
    store = new AutopilotStore('test-project');
    store.ensureDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe('basic drain', () => {
    it('calls step.process for a pending action', async () => {
      const step = makeStep();
      const callbacks = makeCallbacks();
      const orch = createOrchestrator(store, [step], callbacks);

      writeActionFile('action-1');
      store.addPending(makePending());
      orch.requestDrain();

      await vi.waitFor(() => {
        expect(step.process).toHaveBeenCalledTimes(1);
      });

      orch.stop();
    });

    it('removes the action from pending after processing', async () => {
      const step = makeStep();
      const callbacks = makeCallbacks();
      const orch = createOrchestrator(store, [step], callbacks);

      writeActionFile('action-1');
      store.addPending(makePending());
      orch.requestDrain();

      await vi.waitFor(() => {
        expect(store.getPending()).toHaveLength(0);
      });

      orch.stop();
    });

    it('increments processed count', async () => {
      const step = makeStep();
      const callbacks = makeCallbacks();
      const orch = createOrchestrator(store, [step], callbacks);

      writeActionFile('action-1');
      store.addPending(makePending());
      orch.requestDrain();

      await vi.waitFor(() => {
        expect(orch.getProcessedCount('coordinate')).toBe(1);
      });

      orch.stop();
    });

    it('adds span ID to trace.spanIds after processing', async () => {
      const step = makeStep();
      const callbacks = makeCallbacks();
      const traces = new Map<string, TraceItem>();
      const orch = createOrchestrator(store, [step], callbacks, traces);

      writeActionFile('action-1');
      store.addPending(makePending());
      orch.requestDrain();

      await vi.waitFor(() => {
        expect(step.process).toHaveBeenCalledTimes(1);
      });

      const trace = traces.get('trace-1');
      expect(trace).toBeDefined();
      expect(trace?.spanIds).toContain('result-span-1');

      orch.stop();
    });
  });

  describe('cascading', () => {
    it('processes cascaded actions in a single drain', async () => {
      const planStep = makeStep({
        config: { actionType: 'plan', maxParallel: 5 },
        process: vi.fn().mockResolvedValue({
          spanId: 'plan-span',
        } satisfies StepResult),
      });

      const coordinateStep = makeStep({
        config: { actionType: 'coordinate', maxParallel: 5 },
        process: vi.fn().mockImplementation(async () => {
          // Write the plan action file (orchestrator handles enqueuing)
          writeActionFile('plan-action-1', { action: 'plan' });
          return {
            spanId: 'coord-span',
            newActions: [{ actionId: 'plan-action-1', action: 'plan' }],
          } satisfies StepResult;
        }),
      });

      const callbacks = makeCallbacks();
      const orch = createOrchestrator(
        store,
        [coordinateStep, planStep],
        callbacks
      );

      writeActionFile('action-1');
      store.addPending(makePending({ action: 'coordinate' }));
      orch.requestDrain();

      await vi.waitFor(() => {
        expect(planStep.process).toHaveBeenCalledTimes(1);
      });

      expect(coordinateStep.process).toHaveBeenCalledTimes(1);

      orch.stop();
    });
  });

  describe('concurrency limits', () => {
    it('respects maxParallel', async () => {
      let running = 0;
      let maxRunning = 0;
      const resolvers: Array<() => void> = [];

      const step = makeStep({
        config: { actionType: 'coordinate', maxParallel: 2 },
        process: vi.fn().mockImplementation(async () => {
          running++;
          maxRunning = Math.max(maxRunning, running);
          await new Promise<void>(r => {
            resolvers.push(r);
          });
          running--;
          return { spanId: 'span' } satisfies StepResult;
        }),
      });

      const callbacks = makeCallbacks();
      const orch = createOrchestrator(store, [step], callbacks);

      writeActionFile('a-1');
      writeActionFile('a-2');
      writeActionFile('a-3');
      store.addPending(makePending({ actionId: 'a-1' }));
      store.addPending(makePending({ actionId: 'a-2' }));
      store.addPending(makePending({ actionId: 'a-3' }));

      orch.requestDrain();

      // Wait for 2 to be running concurrently
      await vi.waitFor(() => {
        expect(running).toBe(2);
      });

      // Only 2 should have started (maxParallel=2)
      expect(step.process).toHaveBeenCalledTimes(2);
      expect(maxRunning).toBe(2);

      // Resolve them to allow the 3rd to be picked up
      for (const r of resolvers) r();

      orch.stop();
    });
  });

  describe('error handling', () => {
    it('removes action from pending when step throws', async () => {
      const step = makeStep({
        process: vi.fn().mockRejectedValue(new Error('step failed')),
      });

      const callbacks = makeCallbacks();
      const traces = new Map<string, TraceItem>();
      const orch = createOrchestrator(store, [step], callbacks, traces);

      writeActionFile('action-1');
      store.addPending(makePending());
      orch.requestDrain();

      await vi.waitFor(() => {
        expect(callbacks.tracesUpdated).toBeGreaterThan(0);
      });

      // Wait for error handling
      await new Promise(r => setTimeout(r, 50));

      // Pending action should be removed
      expect(store.getPending()).toHaveLength(0);

      orch.stop();
    });
  });

  describe('failTrace', () => {
    it('removes all nextActions from pending and clears the list', () => {
      const step = makeStep();
      const callbacks = makeCallbacks();
      const traces = new Map<string, TraceItem>();

      traces.set('trace-1', {
        traceId: 'trace-1',
        summary: 'test',
        spanIds: ['span-done'],
        nextActions: ['a-pending-1', 'a-pending-2'],
        createdAt: new Date().toISOString(),
      });

      // Add pending actions to store
      store.addPending(
        makePending({
          actionId: 'a-pending-1',
          traceId: 'trace-1',
          action: 'plan',
        })
      );
      store.addPending(
        makePending({
          actionId: 'a-pending-2',
          traceId: 'trace-1',
          action: 'workflow',
        })
      );

      const orch = createOrchestrator(store, [step], callbacks, traces);

      orch.failTrace('trace-1', 'upstream failure');

      const trace = traces.get('trace-1');
      expect(trace).toBeDefined();
      expect(trace?.spanIds).toEqual(['span-done']);
      expect(trace?.nextActions).toEqual([]);

      // Pending actions removed from store
      expect(store.getPending()).toHaveLength(0);

      expect(callbacks.tracesUpdated).toBeGreaterThan(0);

      orch.stop();
    });
  });

  describe('pending status', () => {
    it('keeps action in queue when step returns pending status', async () => {
      let callCount = 0;
      const step = makeStep({
        process: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) {
            return {
              spanId: 'span',
              status: 'pending',
            } satisfies StepResult;
          }
          return {
            spanId: 'span',
          } satisfies StepResult;
        }),
      });

      const callbacks = makeCallbacks();
      const orch = createOrchestrator(store, [step], callbacks);

      writeActionFile('action-1');
      store.addPending(makePending());
      orch.requestDrain();

      await vi.waitFor(() => {
        expect(step.process).toHaveBeenCalledTimes(1);
      });

      // Action should still be in pending queue
      expect(store.getPending()).toHaveLength(1);

      orch.stop();
    });
  });

  describe('drain coalescing', () => {
    it('re-drains when requestDrain is called during active drain', async () => {
      let processCount = 0;
      const step = makeStep({
        process: vi.fn().mockImplementation(async () => {
          processCount++;
          // During first process, add another action and request drain
          if (processCount === 1) {
            writeActionFile('a-2');
            store.addPending(makePending({ actionId: 'a-2' }));
          }
          return { spanId: 'span' } satisfies StepResult;
        }),
      });

      const callbacks = makeCallbacks();
      const orch = createOrchestrator(store, [step], callbacks);

      writeActionFile('a-1');
      store.addPending(makePending({ actionId: 'a-1' }));
      orch.requestDrain();

      // Also request drain immediately (should coalesce)
      orch.requestDrain();

      await vi.waitFor(
        () => {
          expect(processCount).toBe(2);
        },
        { timeout: 2000 }
      );

      orch.stop();
    });
  });

  describe('trace get-or-create', () => {
    it('creates a new trace for a new traceId', async () => {
      const step = makeStep();
      const callbacks = makeCallbacks();
      const traces = new Map<string, TraceItem>();
      const orch = createOrchestrator(store, [step], callbacks, traces);

      writeActionFile('action-1', { reasoning: 'test action' });
      store.addPending(makePending({ traceId: 'new-trace' }));
      orch.requestDrain();

      await vi.waitFor(() => {
        expect(traces.has('new-trace')).toBe(true);
      });

      const trace = traces.get('new-trace');
      expect(trace).toBeDefined();
      expect(trace?.traceId).toBe('new-trace');
      expect(trace?.spanIds).toEqual(expect.any(Array));
      expect(trace?.nextActions).toEqual(expect.any(Array));

      orch.stop();
    });

    it('reuses an existing trace for a known traceId', async () => {
      const step = makeStep();
      const callbacks = makeCallbacks();
      const traces = new Map<string, TraceItem>();

      traces.set('trace-1', {
        traceId: 'trace-1',
        summary: 'existing',
        spanIds: [],
        nextActions: [],
        createdAt: new Date().toISOString(),
      });

      const orch = createOrchestrator(store, [step], callbacks, traces);

      writeActionFile('action-1');
      store.addPending(makePending({ traceId: 'trace-1' }));
      orch.requestDrain();

      await vi.waitFor(() => {
        expect(step.process).toHaveBeenCalledTimes(1);
      });

      // Still the same trace
      expect(traces.get('trace-1')?.summary).toBe('existing');

      orch.stop();
    });
  });

  describe('event span prepend', () => {
    it('includes event span when meta.eventSpanId is present', async () => {
      const step = makeStep();
      const callbacks = makeCallbacks();
      const traces = new Map<string, TraceItem>();
      const orch = createOrchestrator(store, [step], callbacks, traces);

      writeActionFile('action-1', {
        meta: { eventSpanId: 'evt-span-1' },
      });
      store.addPending(
        makePending({
          traceId: 'trace-with-event',
        })
      );
      orch.requestDrain();

      await vi.waitFor(() => {
        expect(traces.has('trace-with-event')).toBe(true);
      });

      const trace = traces.get('trace-with-event');
      expect(trace).toBeDefined();
      expect(trace?.spanIds[0]).toBe('evt-span-1');

      orch.stop();
    });
  });

  describe('nextActions tracking', () => {
    it('adds enqueued actions to trace.nextActions and removes after processing', async () => {
      const planStep = makeStep({
        config: { actionType: 'plan', maxParallel: 5 },
        process: vi.fn().mockResolvedValue({
          spanId: 'plan-span',
        } satisfies StepResult),
      });

      const coordinateStep = makeStep({
        config: { actionType: 'coordinate', maxParallel: 5 },
        process: vi.fn().mockImplementation(async () => {
          writeActionFile('plan-action-1', { action: 'plan' });
          return {
            spanId: 'coord-span',
            newActions: [{ actionId: 'plan-action-1', action: 'plan' }],
          } satisfies StepResult;
        }),
      });

      const callbacks = makeCallbacks();
      const traces = new Map<string, TraceItem>();
      const orch = createOrchestrator(
        store,
        [coordinateStep, planStep],
        callbacks,
        traces
      );

      writeActionFile('action-1');
      store.addPending(makePending({ action: 'coordinate' }));
      orch.requestDrain();

      await vi.waitFor(() => {
        expect(planStep.process).toHaveBeenCalledTimes(1);
      });

      const trace = traces.get('trace-1');
      expect(trace).toBeDefined();
      // After both steps complete, nextActions should be empty
      expect(trace?.nextActions).toEqual([]);
      // Both spans should be recorded
      expect(trace?.spanIds).toContain('coord-span');
      expect(trace?.spanIds).toContain('plan-span');

      orch.stop();
    });
  });

  describe('callbacks', () => {
    it('fires onTracesUpdated on successful process', async () => {
      const step = makeStep();
      const callbacks = makeCallbacks();
      const orch = createOrchestrator(store, [step], callbacks);

      writeActionFile('action-1');
      store.addPending(makePending());
      orch.requestDrain();

      await vi.waitFor(() => {
        expect(callbacks.tracesUpdated).toBeGreaterThan(0);
      });

      orch.stop();
    });

    it('fires onStatusChanged with processing and idle', async () => {
      const step = makeStep();
      const callbacks = makeCallbacks();
      const orch = createOrchestrator(store, [step], callbacks);

      writeActionFile('action-1');
      store.addPending(makePending());
      orch.requestDrain();

      await vi.waitFor(() => {
        const statuses = callbacks.statusChanges.map(s => s.status);
        expect(statuses).toContain('processing');
        expect(statuses).toContain('idle');
      });

      orch.stop();
    });

    it('fires onStatusChanged with error when step throws', async () => {
      const step = makeStep({
        process: vi.fn().mockRejectedValue(new Error('boom')),
      });

      const callbacks = makeCallbacks();
      const orch = createOrchestrator(store, [step], callbacks);

      writeActionFile('action-1');
      store.addPending(makePending());
      orch.requestDrain();

      await vi.waitFor(() => {
        const statuses = callbacks.statusChanges.map(s => s.status);
        expect(statuses).toContain('error');
      });

      orch.stop();
    });
  });
});
