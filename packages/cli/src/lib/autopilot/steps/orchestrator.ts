import type { AutopilotStore } from '../store.js';
import type { TraceItem, PendingAction } from '../types.js';
import type { MemoryStore } from '../memory/store.js';
import type { ProjectManager, WorkflowStore } from 'rover-core';
import type {
  BaseContext,
  OrchestratorCallbacks,
  Step,
  StepContext,
  StepResult,
} from './types.js';

export interface StepOrchestratorOptions {
  steps: Step[];
  store: AutopilotStore;
  traces: Map<string, TraceItem>;
  project: ProjectManager;
  owner?: string;
  repo?: string;
  workflowStore?: WorkflowStore;
  memoryStore?: MemoryStore;
  botName?: string;
  maintainers?: string[];
  customInstructions?: string;
  mode?: string;
  callbacks: OrchestratorCallbacks;
  fallbackIntervalMs?: number;
}

/**
 * Drives the autopilot pipeline by reading pending actions from the store,
 * dispatching them to the appropriate step handler, and cascading results.
 */
export class StepOrchestrator {
  private readonly steps: Map<string, Step>;
  private readonly store: AutopilotStore;
  private readonly traces: Map<string, TraceItem>;
  private readonly baseContext: BaseContext;
  private readonly callbacks: OrchestratorCallbacks;
  private readonly fallbackIntervalMs: number;

  /** Actions currently being processed, keyed by action type → Set of action IDs. */
  private readonly inProgress = new Map<string, Set<string>>();
  /** Lifetime counter of processed actions per action type. */
  private readonly processedCounts = new Map<string, number>();

  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private draining = false;
  private drainRequested = false;

  constructor(opts: StepOrchestratorOptions) {
    this.steps = new Map<string, Step>();
    for (const step of opts.steps) {
      this.steps.set(step.config.actionType, step);
    }

    this.store = opts.store;
    this.traces = opts.traces;
    this.callbacks = opts.callbacks;
    this.fallbackIntervalMs = opts.fallbackIntervalMs ?? 30_000;

    this.baseContext = {
      store: opts.store,
      project: opts.project,
      owner: opts.owner,
      repo: opts.repo,
      workflowStore: opts.workflowStore,
      memoryStore: opts.memoryStore,
      botName: opts.botName,
      maintainers: opts.maintainers,
      customInstructions: opts.customInstructions,
      mode: opts.mode,
    };
  }

  /** Start the orchestrator: immediate drain + periodic fallback. */
  start(): void {
    this.requestDrain();
    this.intervalHandle = setInterval(() => {
      this.requestDrain();
    }, this.fallbackIntervalMs);
  }

  /** Stop the periodic fallback timer. */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Return the lifetime count of processed actions for a given action type. */
  getProcessedCount(actionType: string): number {
    return this.processedCounts.get(actionType) ?? 0;
  }

  /** Trigger an immediate drain. Coalesces with any in-flight drain. */
  requestDrain(): void {
    if (this.draining) {
      this.drainRequested = true;
      return;
    }
    this.drain().catch(() => {});
  }

  /**
   * Core drain loop. Reads all pending actions, dispatches to step handlers,
   * and cascades until no new actions are enqueued.
   */
  private async drain(): Promise<void> {
    this.draining = true;
    this.drainRequested = false;

    try {
      let cascading = true;

      while (cascading) {
        cascading = false;

        const pending = this.store.getPending();
        const byType = new Map<string, PendingAction[]>();

        for (const action of pending) {
          const list = byType.get(action.action) ?? [];
          list.push(action);
          byType.set(action.action, list);
        }

        const batchPromises: Promise<boolean>[] = [];

        for (const [actionType, step] of this.steps) {
          const actions = byType.get(actionType);
          if (!actions || actions.length === 0) continue;

          const inProgressSet = this.getInProgressSet(actionType);

          // Filter out actions already in progress
          const available = actions.filter(a => !inProgressSet.has(a.actionId));

          // Compute available slots
          const slots = step.config.maxParallel - inProgressSet.size;
          if (slots <= 0) continue;

          const batch = available.slice(0, slots);

          for (const action of batch) {
            inProgressSet.add(action.actionId);
            this.callbacks.onStatusChanged(actionType, 'processing');

            batchPromises.push(
              this.processOne(step, action)
                .then(didEnqueue => didEnqueue)
                .catch(() => {
                  this.callbacks.onStatusChanged(actionType, 'error');
                  return false;
                })
            );
          }
        }

        if (batchPromises.length === 0) break;

        const results = await Promise.allSettled(batchPromises);

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            cascading = true;
          }
        }
      }

      // Notify idle for all steps
      for (const actionType of this.steps.keys()) {
        const inProgressSet = this.inProgress.get(actionType);
        if (!inProgressSet || inProgressSet.size === 0) {
          this.callbacks.onStatusChanged(actionType, 'idle');
        }
      }
    } finally {
      this.draining = false;

      if (this.drainRequested) {
        this.drain().catch(() => {});
      }
    }
  }

  /**
   * Process a single action through its step handler.
   * Returns true if the step enqueued new actions (for cascading).
   */
  private async processOne(
    step: Step,
    action: PendingAction
  ): Promise<boolean> {
    const actionType = step.config.actionType;
    const inProgressSet = this.getInProgressSet(actionType);

    try {
      // Get or create trace
      const trace = this.getOrCreateTrace(action);
      this.callbacks.onTracesUpdated();

      // Build context
      const ctx: StepContext = {
        ...this.baseContext,
        trace,
        failTrace: (reason: string) => this.failTrace(action.traceId, reason),
      };

      // Execute step
      const result = await step.process(action, ctx);

      // Handle 'pending' status — action stays in queue for retry
      if (result.status === 'pending') {
        this.callbacks.onTracesUpdated();
        return false;
      }

      // Record the span created by this step
      if (result.spanId) {
        if (!trace.spanIds.includes(result.spanId)) {
          trace.spanIds.push(result.spanId);
        }
      }

      // Move action from nextActions now that it's been processed
      trace.nextActions = trace.nextActions.filter(
        id => id !== action.actionId
      );

      // Enqueue new actions returned by the step
      this.enqueueStepResults(action, result);

      // Remove processed action from pending queue
      this.store.removePending(action.actionId);

      // Increment processed count
      this.processedCounts.set(
        actionType,
        (this.processedCounts.get(actionType) ?? 0) + 1
      );

      this.callbacks.onTracesUpdated();

      return (result.newActions?.length ?? 0) > 0;
    } catch (_err) {
      // Remove from pending
      this.store.removePending(action.actionId);

      // Remove from nextActions
      const trace = this.traces.get(action.traceId);
      if (trace) {
        trace.nextActions = trace.nextActions.filter(
          id => id !== action.actionId
        );
      }

      this.callbacks.onTracesUpdated();
      throw _err;
    } finally {
      inProgressSet.delete(action.actionId);
    }
  }

  /**
   * Mark a trace as failed: remove all pending next actions from the
   * store and clear the nextActions list.
   */
  failTrace(traceId: string, reason: string): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    for (const actionId of trace.nextActions) {
      this.store.removePending(actionId);
    }
    trace.nextActions = [];

    // Store the failure reason in trace summary for visibility
    void reason;

    this.callbacks.onTracesUpdated();
  }

  /**
   * Enqueue actions returned by a step: add to pending queue, track in
   * the trace's nextActions, and write an audit log entry.
   */
  private enqueueStepResults(source: PendingAction, result: StepResult): void {
    if (!result.newActions || result.newActions.length === 0) return;

    const trace = this.traces.get(source.traceId);

    for (const enqueued of result.newActions) {
      this.store.addPending({
        traceId: source.traceId,
        actionId: enqueued.actionId,
        action: enqueued.action,
      });

      const actionData = this.store.readAction(enqueued.actionId);
      this.store.appendLog({
        ts: new Date().toISOString(),
        traceId: source.traceId,
        spanId: result.spanId,
        actionId: enqueued.actionId,
        step: source.action,
        action: enqueued.action,
        summary: actionData?.reasoning ?? enqueued.action,
      });

      if (trace && !trace.nextActions.includes(enqueued.actionId)) {
        trace.nextActions.push(enqueued.actionId);
      }
    }
  }

  /** Get or create the in-progress set for an action type. */
  private getInProgressSet(actionType: string): Set<string> {
    let set = this.inProgress.get(actionType);
    if (!set) {
      set = new Set<string>();
      this.inProgress.set(actionType, set);
    }
    return set;
  }

  /** Get or create a trace for the given action. */
  private getOrCreateTrace(action: PendingAction): TraceItem {
    let trace = this.traces.get(action.traceId);

    if (!trace) {
      // Read the action file to get summary and eventSpanId
      const actionData = this.store.readAction(action.actionId);

      trace = {
        traceId: action.traceId,
        summary: actionData?.reasoning ?? action.action,
        spanIds: [],
        nextActions: [],
        createdAt: new Date().toISOString(),
      };

      // Prepend event span if meta.eventSpanId is present
      if (actionData?.meta?.eventSpanId) {
        trace.spanIds.push(actionData.meta.eventSpanId as string);
      }

      this.traces.set(action.traceId, trace);
    }

    return trace;
  }
}
