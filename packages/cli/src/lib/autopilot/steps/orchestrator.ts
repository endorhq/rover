import type { ProjectManager } from 'rover-core';
import type { ActionTrace, ActionStep, PendingAction } from '../types.js';
import type { AutopilotStore } from '../store.js';
import type {
  Step,
  StepResult,
  TraceMutations,
  MonitorContext,
  OrchestratorCallbacks,
} from './types.js';

const DEFAULT_FALLBACK_INTERVAL_MS = 30_000;

/**
 * StepOrchestrator — pure TypeScript class with zero React dependencies.
 *
 * Processing model: hybrid event-driven + fallback interval.
 *
 * 1. **Eager drain**: When new actions are enqueued, the orchestrator
 *    immediately re-drains the pending queue. This creates natural
 *    cascading: event -> coordinate -> plan -> workflow without waiting.
 *
 * 2. **Fallback interval**: A single background timer runs for monitor()
 *    calls, startup recovery, and edge cases.
 *
 * 3. **Drain cycle**: Reads all pending actions, groups by type, matches
 *    to step, applies dedup, batches per maxParallel, processes via
 *    Promise.allSettled. Cascades if any result has enqueuedActions.
 */
export class StepOrchestrator {
  private steps: Map<string, Step>;
  private store: AutopilotStore;
  private traces: Map<string, ActionTrace>;
  private projectId: string;
  private projectPath: string;
  private owner?: string;
  private repo?: string;
  private project?: ProjectManager;
  private callbacks: OrchestratorCallbacks;
  private fallbackIntervalMs: number;

  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private inProgress: Map<string, Set<string>> = new Map();
  private processedCounts: Map<string, number> = new Map();
  private draining = false;
  private drainRequested = false;

  constructor(opts: {
    steps: Step[];
    store: AutopilotStore;
    traces: Map<string, ActionTrace>;
    projectId: string;
    projectPath: string;
    owner?: string;
    repo?: string;
    project?: ProjectManager;
    callbacks: OrchestratorCallbacks;
    fallbackIntervalMs?: number;
  }) {
    this.steps = new Map();
    for (const step of opts.steps) {
      this.steps.set(step.config.actionType, step);
    }
    this.store = opts.store;
    this.traces = opts.traces;
    this.projectId = opts.projectId;
    this.projectPath = opts.projectPath;
    this.owner = opts.owner;
    this.repo = opts.repo;
    this.project = opts.project;
    this.callbacks = opts.callbacks;
    this.fallbackIntervalMs =
      opts.fallbackIntervalMs ?? DEFAULT_FALLBACK_INTERVAL_MS;

    // Initialize per-step tracking
    for (const step of opts.steps) {
      this.inProgress.set(step.config.actionType, new Set());
      this.processedCounts.set(step.config.actionType, 0);
    }
  }

  /** Start the orchestrator: immediate drain + fallback interval. */
  start(): void {
    this.drain();
    this.intervalHandle = setInterval(
      () => this.tick(),
      this.fallbackIntervalMs
    );
  }

  /** Stop the orchestrator: clear the fallback interval. */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Get the current processed count for a step type. */
  getProcessedCount(actionType: string): number {
    return this.processedCounts.get(actionType) ?? 0;
  }

  /** Request an immediate drain of the pending queue.
   *  Safe to call from outside — coalesces with any in-flight drain. */
  requestDrain(): void {
    this.drain();
  }

  // ── Tick ────────────────────────────────────────────────────────────────

  private tick(): void {
    this.runMonitors();
    this.drain();
  }

  // ── Monitors ─────────────────────────────────────────────────────────

  /** Run all step monitor() calls. Monitors check external state (e.g.
   *  task completion on disk) and enqueue new actions into the store. */
  private runMonitors(): void {
    for (const [, step] of this.steps) {
      if (!step.monitor) continue;

      const ctx: MonitorContext = {
        store: this.store,
        projectId: this.projectId,
        projectPath: this.projectPath,
        traces: this.traces,
        owner: this.owner,
        repo: this.repo,
        project: this.project,
      };

      const mutations = step.monitor(ctx);
      if (mutations) {
        this.applyTraceMutations(mutations);
      }
    }
  }

  // ── Drain ───────────────────────────────────────────────────────────────

  private async drain(): Promise<void> {
    if (this.draining) {
      this.drainRequested = true;
      return;
    }

    this.draining = true;

    try {
      let hadEnqueuedActions = true;

      while (hadEnqueuedActions) {
        hadEnqueuedActions = false;

        // Check external state before reading pending — monitors may
        // detect completed tasks and enqueue new actions (e.g. commit).
        this.runMonitors();

        // Read all pending actions
        const pending = this.store.getPending();
        if (pending.length === 0) break;

        // Group by action type
        const grouped = new Map<string, PendingAction[]>();
        for (const p of pending) {
          const list = grouped.get(p.action) ?? [];
          list.push(p);
          grouped.set(p.action, list);
        }

        // Build batches for each step
        const allBatches: Array<{ step: Step; action: PendingAction }> = [];

        for (const [actionType, actions] of grouped) {
          const step = this.steps.get(actionType);
          if (!step) continue;

          const inProgressSet = this.inProgress.get(actionType)!;

          // Filter out already in-progress
          let eligible = actions.filter(a => !inProgressSet.has(a.actionId));

          // Apply dedup if configured
          if (step.config.dedupBy === 'traceId') {
            const seenTraces = new Set<string>();
            const deduped: PendingAction[] = [];
            const toRemove: string[] = [];

            for (const a of eligible) {
              if (seenTraces.has(a.traceId)) {
                toRemove.push(a.actionId);
              } else {
                seenTraces.add(a.traceId);
                deduped.push(a);
              }
            }

            for (const actionId of toRemove) {
              this.store.removePending(actionId);
            }

            eligible = deduped;
          }

          // Compute available slots
          const available = step.config.maxParallel - inProgressSet.size;
          if (available <= 0) continue;

          const batch = eligible.slice(0, available);
          for (const action of batch) {
            allBatches.push({ step, action });
          }
        }

        if (allBatches.length === 0) break;

        // Mark all as in-progress and notify status
        for (const { step, action } of allBatches) {
          this.inProgress.get(step.config.actionType)!.add(action.actionId);
        }

        // Notify processing status for all affected step types
        const affectedTypes = new Set(
          allBatches.map(b => b.step.config.actionType)
        );
        for (const actionType of affectedTypes) {
          this.callbacks.onStatusChanged(
            actionType,
            'processing',
            this.processedCounts.get(actionType) ?? 0
          );
        }

        // Process all batches
        const results = await Promise.allSettled(
          allBatches.map(({ step, action }) => this.processOne(step, action))
        );

        // Check for enqueued actions (cascading)
        for (const result of results) {
          if (
            result.status === 'fulfilled' &&
            result.value &&
            result.value.enqueuedActions.length > 0
          ) {
            hadEnqueuedActions = true;
          }
        }

        // Notify idle/error status for affected step types
        for (const actionType of affectedTypes) {
          const typeResults = results.filter(
            (_, i) => allBatches[i].step.config.actionType === actionType
          );
          const hasError = typeResults.some(r => r.status === 'rejected');
          this.callbacks.onStatusChanged(
            actionType,
            hasError ? 'error' : 'idle',
            this.processedCounts.get(actionType) ?? 0
          );
        }
      }
    } finally {
      this.draining = false;

      if (this.drainRequested) {
        this.drainRequested = false;
        this.drain();
      }
    }
  }

  // ── Process one action ──────────────────────────────────────────────────

  private async processOne(
    step: Step,
    action: PendingAction
  ): Promise<StepResult> {
    const actionType = step.config.actionType;
    const inProgressSet = this.inProgress.get(actionType)!;

    try {
      // Get or create trace
      const trace = this.traces.get(action.traceId) ?? {
        traceId: action.traceId,
        summary: action.summary,
        steps: [],
        createdAt: action.createdAt,
      };

      // Idempotent: reuse existing step if present (e.g. after restart)
      let runningStep = trace.steps.find(s => s.actionId === action.actionId);
      if (!runningStep) {
        runningStep = {
          actionId: action.actionId,
          action: actionType,
          status: 'running',
          timestamp: new Date().toISOString(),
        };
        trace.steps.push(runningStep);
      } else {
        runningStep.status = 'running';
      }
      this.traces.set(action.traceId, trace);
      this.callbacks.onTracesUpdated();

      // Build context
      const ctx = {
        store: this.store,
        projectId: this.projectId,
        projectPath: this.projectPath,
        trace,
        owner: this.owner,
        repo: this.repo,
        project: this.project,
      };

      // Call step.process()
      const result = await step.process(action, ctx);

      // Apply result to trace
      const resultStatus = result.status ?? 'completed';

      // 'pending' means the action isn't ready yet — restore step and skip
      if (resultStatus === 'pending') {
        runningStep.status = 'pending';
        this.traces.set(action.traceId, trace);
        this.callbacks.onTracesUpdated();
        return result;
      }

      runningStep.status = resultStatus;
      runningStep.reasoning = result.reasoning;
      if (result.spanId) {
        runningStep.spanId = result.spanId;
      }
      if (result.terminal) {
        runningStep.terminal = true;
      }

      // Add enqueued actions as pending steps in trace (skip duplicates)
      // NOTE: This runs BEFORE traceMutations so that steps can create an
      // action and immediately mark it completed (e.g. noop end-steps).
      for (const enqueued of result.enqueuedActions) {
        if (!trace.steps.some(s => s.actionId === enqueued.actionId)) {
          trace.steps.push({
            actionId: enqueued.actionId,
            action: enqueued.actionType,
            status: 'pending',
            timestamp: new Date().toISOString(),
            reasoning: enqueued.summary,
          });
        }
      }

      // Apply trace mutations if present
      if (result.traceMutations?.stepUpdates) {
        for (const update of result.traceMutations.stepUpdates) {
          const s = trace.steps.find(s => s.actionId === update.actionId);
          if (s) {
            s.status = update.status;
            if (update.reasoning) s.reasoning = update.reasoning;
          }
        }
      }

      this.traces.set(action.traceId, trace);
      this.callbacks.onTracesUpdated();

      // Increment processed count
      const count = (this.processedCounts.get(actionType) ?? 0) + 1;
      this.processedCounts.set(actionType, count);

      return result;
    } catch (err) {
      // Mark step as failed in trace
      const trace = this.traces.get(action.traceId);
      if (trace) {
        const s = trace.steps.find(s => s.actionId === action.actionId);
        if (s) {
          s.status = 'failed';
          s.reasoning = err instanceof Error ? err.message : String(err);
        }
        this.traces.set(action.traceId, trace);
        this.callbacks.onTracesUpdated();
      }

      // Remove from pending on failure
      this.store.removePending(action.actionId);

      throw err;
    } finally {
      inProgressSet.delete(action.actionId);
    }
  }

  // ── Apply trace mutations from monitor ──────────────────────────────────

  private applyTraceMutations(mutations: TraceMutations): void {
    let updated = false;

    for (const update of mutations.updates) {
      const trace = this.traces.get(update.traceId);
      if (!trace) continue;

      for (const stepUpdate of update.stepUpdates) {
        const step = trace.steps.find(s => s.actionId === stepUpdate.actionId);
        if (step) {
          step.status = stepUpdate.status;
          if (stepUpdate.reasoning) step.reasoning = stepUpdate.reasoning;
          updated = true;
        }
      }

      for (const newStep of update.newSteps) {
        if (!trace.steps.some(s => s.actionId === newStep.actionId)) {
          trace.steps.push(newStep);
          updated = true;
        }
      }

      this.traces.set(update.traceId, trace);
    }

    if (updated) {
      this.callbacks.onTracesUpdated();
    }
  }
}
