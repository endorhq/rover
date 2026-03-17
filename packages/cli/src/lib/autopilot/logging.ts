import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectPath } from 'rover-core';
import type { AutopilotStore } from './store.js';
import type { Action, Span, SpanStatus } from './types.js';

/**
 * Manages a span's lifecycle on disk. Created with `status: 'running'`
 * and finalized exactly once via `complete()`, `fail()`, or `error()`.
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
      originAction?: string | null;
      meta?: Record<string, unknown>;
    }
  ) {
    this.id = randomUUID();

    const spansDir = join(getProjectPath(projectId), 'spans');
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
      originAction: opts.originAction ?? null,
      newActions: [],
    };

    this.write();
  }

  /** Mark the span as successfully completed. */
  complete(summary: string, extraMeta?: Record<string, unknown>): void {
    this.finalize('completed', summary, extraMeta);
  }

  /** Mark the span as failed (step ran but outcome was negative). */
  fail(summary: string, extraMeta?: Record<string, unknown>): void {
    this.finalize('failed', summary, extraMeta);
  }

  /** Mark the span as errored (unexpected/environmental failure). */
  error(summary: string, extraMeta?: Record<string, unknown>): void {
    this.finalize('error', summary, extraMeta);
  }

  private finalize(
    status: SpanStatus,
    summary: string,
    extraMeta?: Record<string, unknown>
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

/**
 * Update an existing span on disk. No-op if the span is already finalized
 * or the file is missing. Used for spans left `running` by long-lived steps.
 */
export function finalizeSpan(
  projectId: string,
  spanId: string,
  status: SpanStatus,
  summary: string,
  extraMeta?: Record<string, unknown>
): void {
  const filePath = join(getProjectPath(projectId), 'spans', `${spanId}.json`);

  let data: Span;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return;
  }

  if (data.completed) return;

  data.status = status;
  data.summary = summary;
  data.completed = new Date().toISOString();

  if (extraMeta) {
    data.meta = { ...data.meta, ...extraMeta };
  }

  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Append an action ID to a span's `newActions` array on disk.
 * No-op if the span file is missing. Idempotent (skips duplicates).
 */
export function linkNewAction(
  projectId: string,
  spanId: string,
  actionId: string
): void {
  const filePath = join(getProjectPath(projectId), 'spans', `${spanId}.json`);

  let data: Span;
  try {
    data = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return;
  }

  if (!data.newActions) {
    data.newActions = [];
  }

  if (data.newActions.includes(actionId)) return;

  data.newActions.push(actionId);
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Creates an immutable action and writes it to disk. Actions represent
 * an intent for a next step and are never modified after creation.
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
      meta?: Record<string, unknown>;
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

    const actionsDir = join(getProjectPath(projectId), 'actions');
    writeFileSync(
      join(actionsDir, `${this.id}.json`),
      JSON.stringify(this.data, null, 2)
    );

    linkNewAction(projectId, opts.spanId, this.id);
  }
}

/**
 * Add an action to the pending queue and write an audit log entry.
 * This is the standard way to make an action visible to the pipeline.
 */
export function enqueueAction(
  store: AutopilotStore,
  opts: {
    traceId: string;
    action: ActionWriter;
    step: string;
    summary: string;
  }
): void {
  const { action } = opts;

  store.addPending({
    traceId: opts.traceId,
    actionId: action.id,
    action: action.data.action,
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

/**
 * Create an action, enqueue it, and optionally remove a processed pending entry.
 * Returns the `ActionWriter` so callers can read `action.id`.
 */
export function emitAction(
  store: AutopilotStore,
  opts: {
    projectId: string;
    traceId: string;
    action: string;
    spanId: string;
    reasoning: string;
    meta?: Record<string, unknown>;
    fromStep: string;
    summary: string;
    removePendingId?: string;
  }
): ActionWriter {
  const action = new ActionWriter(opts.projectId, {
    action: opts.action,
    spanId: opts.spanId,
    reasoning: opts.reasoning,
    meta: opts.meta,
  });

  enqueueAction(store, {
    traceId: opts.traceId,
    action,
    step: opts.fromStep,
    summary: opts.summary,
  });

  if (opts.removePendingId) {
    store.removePending(opts.removePendingId);
  }

  return action;
}
