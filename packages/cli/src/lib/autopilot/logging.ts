import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectPath } from 'rover-core';
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

    this.link(projectId);
  }

  /**
   * Append this action's ID to the parent span's `newActions` array on disk.
   * No-op if the span file is missing. Idempotent (skips duplicates).
   */
  private link(projectId: string): void {
    const filePath = join(
      getProjectPath(projectId),
      'spans',
      `${this.data.spanId}.json`
    );

    let data: Span;
    try {
      data = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      return;
    }

    if (!data.newActions) {
      data.newActions = [];
    }

    if (data.newActions.includes(this.id)) return;

    data.newActions.push(this.id);
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
}
