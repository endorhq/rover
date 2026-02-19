import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getDataDir } from 'rover-core';
import type { Span, Action, SpanStatus } from './types.js';
import type { AutopilotStore } from './store.js';

// ── SpanWriter ──────────────────────────────────────────────────────────────

/**
 * Creates and manages a span's lifecycle.
 *
 * A span is created at the start of a step with `status: 'running'` and
 * written to disk immediately. When the step finishes, call one of the
 * finalization methods (`complete`, `fail`, `error`) to set the final
 * status, summary, and completion timestamp. After finalization the span
 * is immutable — further calls will throw.
 *
 * Usage:
 *
 * ```ts
 * const span = new SpanWriter(projectId, {
 *   step: 'coordinate',
 *   parentId: eventSpanId,
 *   meta: { decision: 'plan' },
 * });
 *
 * // ... do work ...
 *
 * span.complete('decided to plan', { taskCount: 3 });
 * ```
 */
export class SpanWriter {
  readonly id: string;
  private readonly filePath: string;
  private data: Span;
  private finalized = false;

  constructor(
    projectId: string,
    opts: {
      step: string;
      parentId: string | null;
      meta?: Record<string, any>;
    }
  ) {
    this.id = randomUUID();

    const spansDir = join(getDataDir(), 'projects', projectId, 'spans');
    this.filePath = join(spansDir, `${this.id}.json`);

    this.data = {
      id: this.id,
      version: '1.0',
      timestamp: new Date().toISOString(),
      step: opts.step,
      parent: opts.parentId,
      status: 'running',
      completed: null,
      summary: null,
      meta: opts.meta ?? {},
    };

    this.write();
  }

  /** Mark the span as successfully completed. */
  complete(summary: string, extraMeta?: Record<string, any>): void {
    this.finalize('completed', summary, extraMeta);
  }

  /**
   * Mark the span as failed. The step ran to completion but the outcome
   * was negative (e.g. a workflow couldn't solve the problem).
   */
  fail(summary: string, extraMeta?: Record<string, any>): void {
    this.finalize('failed', summary, extraMeta);
  }

  /**
   * Mark the span as errored. The step couldn't finish due to an
   * environmental or unexpected issue (missing tool, crash, etc.).
   */
  error(summary: string, extraMeta?: Record<string, any>): void {
    this.finalize('error', summary, extraMeta);
  }

  private finalize(
    status: SpanStatus,
    summary: string,
    extraMeta?: Record<string, any>
  ): void {
    if (this.finalized) {
      throw new Error(`Span ${this.id} already finalized`);
    }

    this.data.status = status;
    this.data.summary = summary;
    this.data.completed = new Date().toISOString();

    if (extraMeta) {
      this.data.meta = { ...this.data.meta, ...extraMeta };
    }

    this.write();
    this.finalized = true;
  }

  private write(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}

// ── ActionWriter ────────────────────────────────────────────────────────────

/**
 * Creates an immutable action and writes it to disk.
 *
 * Actions represent an intent for a next step. They are created once and
 * never modified. The constructor writes the JSON file immediately.
 *
 * Usage:
 *
 * ```ts
 * const action = new ActionWriter(projectId, {
 *   action: 'workflow',
 *   spanId: planSpan.id,
 *   reasoning: 'Implement the feature described in the issue',
 *   meta: { workflow: 'swe', title: 'Add auth' },
 * });
 *
 * enqueueAction(store, {
 *   traceId,
 *   action,
 *   step: 'plan',
 *   summary: 'swe: Add auth',
 * });
 * ```
 */
export class ActionWriter {
  readonly id: string;
  readonly data: Action;

  constructor(
    projectId: string,
    opts: {
      action: string;
      spanId: string;
      reasoning: string;
      meta?: Record<string, any>;
    }
  ) {
    this.id = randomUUID();

    this.data = {
      id: this.id,
      version: '1.0',
      action: opts.action,
      timestamp: new Date().toISOString(),
      spanId: opts.spanId,
      meta: opts.meta ?? {},
      reasoning: opts.reasoning,
    };

    const actionsDir = join(getDataDir(), 'projects', projectId, 'actions');
    writeFileSync(
      join(actionsDir, `${this.id}.json`),
      JSON.stringify(this.data, null, 2)
    );
  }
}

// ── enqueueAction ───────────────────────────────────────────────────────────

/**
 * Enqueues an action into the pending queue and writes a log entry.
 *
 * This is the standard way to make an action visible to the pipeline
 * after writing it with `ActionWriter`. It combines the two operations
 * that every step performs after creating an action:
 *
 * 1. `store.addPending(...)` — so the target step picks it up.
 * 2. `store.appendLog(...)` — for the structured audit log.
 *
 * The `meta` field on the pending entry defaults to the action's own meta
 * if not provided explicitly.
 */
export function enqueueAction(
  store: AutopilotStore,
  opts: {
    traceId: string;
    action: ActionWriter;
    step: string;
    summary: string;
    meta?: Record<string, any>;
  }
): void {
  const { action } = opts;

  store.addPending({
    traceId: opts.traceId,
    actionId: action.id,
    spanId: action.data.spanId,
    action: action.data.action,
    summary: opts.summary,
    createdAt: new Date().toISOString(),
    meta: opts.meta ?? action.data.meta,
  });

  store.appendLog({
    ts: new Date().toISOString(),
    traceId: opts.traceId,
    spanId: action.data.spanId,
    actionId: action.id,
    step: opts.step,
    action: action.data.action,
    summary: opts.summary,
  });
}
