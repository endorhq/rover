import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

import {
  ActionWriter,
  SpanWriter,
  emitAction,
  enqueueAction,
  finalizeSpan,
  linkNewAction,
} from '../logging.js';
import { AutopilotStore } from '../store.js';
import type { Span } from '../types.js';

function readSpanFile(spanId: string): Span {
  return JSON.parse(
    readFileSync(join(projectDir, 'spans', `${spanId}.json`), 'utf8')
  );
}

describe('SpanWriter', () => {
  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'autopilot-logging-test-'));
    mkdirSync(join(projectDir, 'spans'), { recursive: true });
    mkdirSync(join(projectDir, 'actions'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('creates a span file on disk with running status', () => {
    const span = new SpanWriter('test', {
      step: 'coordinate',
      parentId: null,
    });

    const data = readSpanFile(span.id);
    expect(data.id).toBe(span.id);
    expect(data.step).toBe('coordinate');
    expect(data.status).toBe('running');
    expect(data.parent).toBeNull();
    expect(data.completed).toBeNull();
    expect(data.summary).toBeNull();
    expect(data.newActions).toEqual([]);
  });

  it('stores originAction and meta when provided', () => {
    const span = new SpanWriter('test', {
      step: 'plan',
      parentId: 'parent-1',
      originAction: 'action-origin',
      meta: { key: 'value' },
    });

    const data = readSpanFile(span.id);
    expect(data.parent).toBe('parent-1');
    expect(data.originAction).toBe('action-origin');
    expect(data.meta).toEqual({ key: 'value' });
  });

  it('defaults originAction to null and meta to empty object', () => {
    const span = new SpanWriter('test', {
      step: 'test',
      parentId: null,
    });

    const data = readSpanFile(span.id);
    expect(data.originAction).toBeNull();
    expect(data.meta).toEqual({});
  });

  describe('finalization', () => {
    it('complete() sets status to completed', () => {
      const span = new SpanWriter('test', {
        step: 'test',
        parentId: null,
      });
      span.complete('all good');

      const data = readSpanFile(span.id);
      expect(data.status).toBe('completed');
      expect(data.summary).toBe('all good');
      expect(data.completed).toBeDefined();
    });

    it('fail() sets status to failed', () => {
      const span = new SpanWriter('test', {
        step: 'test',
        parentId: null,
      });
      span.fail('something went wrong');

      const data = readSpanFile(span.id);
      expect(data.status).toBe('failed');
      expect(data.summary).toBe('something went wrong');
    });

    it('error() sets status to error', () => {
      const span = new SpanWriter('test', {
        step: 'test',
        parentId: null,
      });
      span.error('unexpected crash');

      const data = readSpanFile(span.id);
      expect(data.status).toBe('error');
      expect(data.summary).toBe('unexpected crash');
    });

    it('merges extraMeta into existing meta', () => {
      const span = new SpanWriter('test', {
        step: 'test',
        parentId: null,
        meta: { original: true },
      });
      span.complete('done', { extra: 'data' });

      const data = readSpanFile(span.id);
      expect(data.meta).toEqual({ original: true, extra: 'data' });
    });

    it('throws when finalized twice', () => {
      const span = new SpanWriter('test', {
        step: 'test',
        parentId: null,
      });
      span.complete('done');

      expect(() => span.complete('again')).toThrow('already finalized');
      expect(() => span.fail('nope')).toThrow('already finalized');
      expect(() => span.error('nope')).toThrow('already finalized');
    });
  });
});

describe('finalizeSpan', () => {
  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'autopilot-finalize-test-'));
    mkdirSync(join(projectDir, 'spans'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('updates a running span on disk', () => {
    const span = new SpanWriter('test', {
      step: 'test',
      parentId: null,
    });

    finalizeSpan('test', span.id, 'completed', 'finalized externally');

    const data = readSpanFile(span.id);
    expect(data.status).toBe('completed');
    expect(data.summary).toBe('finalized externally');
    expect(data.completed).toBeDefined();
  });

  it('merges extraMeta', () => {
    const span = new SpanWriter('test', {
      step: 'test',
      parentId: null,
      meta: { existing: true },
    });

    finalizeSpan('test', span.id, 'failed', 'failed', { reason: 'timeout' });

    const data = readSpanFile(span.id);
    expect(data.meta).toEqual({ existing: true, reason: 'timeout' });
  });

  it('is a no-op when the span file is missing', () => {
    // Should not throw
    finalizeSpan('test', 'nonexistent-id', 'completed', 'done');
  });

  it('is a no-op when the span is already completed', () => {
    const span = new SpanWriter('test', {
      step: 'test',
      parentId: null,
    });
    span.complete('first');
    const originalData = readSpanFile(span.id);

    finalizeSpan('test', span.id, 'failed', 'should not change');

    const data = readSpanFile(span.id);
    expect(data.status).toBe('completed');
    expect(data.summary).toBe('first');
    expect(data.completed).toBe(originalData.completed);
  });
});

describe('linkNewAction', () => {
  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'autopilot-link-test-'));
    mkdirSync(join(projectDir, 'spans'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('appends an action ID to the span', () => {
    const span = new SpanWriter('test', {
      step: 'test',
      parentId: null,
    });

    linkNewAction('test', span.id, 'new-action-1');

    const data = readSpanFile(span.id);
    expect(data.newActions).toContain('new-action-1');
  });

  it('is idempotent (skips duplicates)', () => {
    const span = new SpanWriter('test', {
      step: 'test',
      parentId: null,
    });

    linkNewAction('test', span.id, 'dup-action');
    linkNewAction('test', span.id, 'dup-action');

    const data = readSpanFile(span.id);
    expect(
      data.newActions.filter((a: string) => a === 'dup-action')
    ).toHaveLength(1);
  });

  it('is a no-op when the span file is missing', () => {
    // Should not throw
    linkNewAction('test', 'missing-span', 'action-1');
  });

  it('initializes newActions array if missing', () => {
    // Write a span without newActions field
    const spanData: Span = {
      id: 'bare-span',
      version: '1.0',
      timestamp: new Date().toISOString(),
      step: 'test',
      parent: null,
      summary: null,
      meta: {},
      originAction: null,
      newActions: undefined as unknown as string[],
    };
    writeFileSync(
      join(projectDir, 'spans', 'bare-span.json'),
      JSON.stringify(spanData)
    );

    linkNewAction('test', 'bare-span', 'action-1');

    const data = readSpanFile('bare-span');
    expect(data.newActions).toEqual(['action-1']);
  });
});

describe('ActionWriter', () => {
  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'autopilot-action-test-'));
    mkdirSync(join(projectDir, 'spans'), { recursive: true });
    mkdirSync(join(projectDir, 'actions'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('creates an action file on disk', () => {
    const span = new SpanWriter('test', {
      step: 'coordinate',
      parentId: null,
    });

    const action = new ActionWriter('test', {
      action: 'plan',
      spanId: span.id,
      reasoning: 'needs planning',
    });

    const data = JSON.parse(
      readFileSync(join(projectDir, 'actions', `${action.id}.json`), 'utf8')
    );

    expect(data.id).toBe(action.id);
    expect(data.action).toBe('plan');
    expect(data.spanId).toBe(span.id);
    expect(data.reasoning).toBe('needs planning');
    expect(data.meta).toEqual({});
  });

  it('stores custom meta', () => {
    const span = new SpanWriter('test', {
      step: 'test',
      parentId: null,
    });

    const action = new ActionWriter('test', {
      action: 'workflow',
      spanId: span.id,
      reasoning: 'custom',
      meta: { issueNumber: 42 },
    });

    expect(action.data.meta).toEqual({ issueNumber: 42 });
  });

  it('links itself to the parent span', () => {
    const span = new SpanWriter('test', {
      step: 'test',
      parentId: null,
    });

    const action = new ActionWriter('test', {
      action: 'plan',
      spanId: span.id,
      reasoning: 'test',
    });

    const spanData = readSpanFile(span.id);
    expect(spanData.newActions).toContain(action.id);
  });
});

describe('enqueueAction', () => {
  let store: AutopilotStore;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'autopilot-enqueue-test-'));
    mkdirSync(join(projectDir, 'spans'), { recursive: true });
    mkdirSync(join(projectDir, 'actions'), { recursive: true });
    store = new AutopilotStore('test');
    store.ensureDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('adds to pending queue and writes a log entry', () => {
    const span = new SpanWriter('test', {
      step: 'coordinate',
      parentId: null,
    });
    const action = new ActionWriter('test', {
      action: 'plan',
      spanId: span.id,
      reasoning: 'test',
    });

    enqueueAction(store, {
      traceId: 'trace-1',
      action,
      step: 'coordinate',
      summary: 'dispatched plan',
    });

    const pending = store.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].actionId).toBe(action.id);
    expect(pending[0].traceId).toBe('trace-1');
    expect(pending[0].action).toBe('plan');

    const logs = store.readLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].step).toBe('coordinate');
    expect(logs[0].action).toBe('plan');
  });

  it('stores only traceId, actionId, and action in pending', () => {
    const span = new SpanWriter('test', {
      step: 'test',
      parentId: null,
    });
    const action = new ActionWriter('test', {
      action: 'plan',
      spanId: span.id,
      reasoning: 'test',
      meta: { actionMeta: true },
    });

    enqueueAction(store, {
      traceId: 'trace-1',
      action,
      step: 'test',
      summary: 'test',
    });

    const pending = store.getPending();
    expect(pending[0]).toEqual({
      traceId: 'trace-1',
      actionId: action.id,
      action: 'plan',
    });
  });
});

describe('emitAction', () => {
  let store: AutopilotStore;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'autopilot-emit-test-'));
    mkdirSync(join(projectDir, 'spans'), { recursive: true });
    mkdirSync(join(projectDir, 'actions'), { recursive: true });
    store = new AutopilotStore('test');
    store.ensureDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('creates an action, enqueues it, and returns the writer', () => {
    const span = new SpanWriter('test', {
      step: 'coordinate',
      parentId: null,
    });

    const result = emitAction(store, {
      projectId: 'test',
      traceId: 'trace-1',
      action: 'plan',
      spanId: span.id,
      reasoning: 'needs planning',
      fromStep: 'coordinate',
      summary: 'emitted plan action',
    });

    expect(result.id).toBeDefined();
    expect(result.data.action).toBe('plan');

    const pending = store.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].actionId).toBe(result.id);
  });

  it('removes a processed pending entry when removePendingId is set', () => {
    const span = new SpanWriter('test', {
      step: 'test',
      parentId: null,
    });

    // Seed a pending entry to be consumed
    store.addPending({
      traceId: 'trace-1',
      actionId: 'old-action',
      action: 'coordinate',
    });

    emitAction(store, {
      projectId: 'test',
      traceId: 'trace-1',
      action: 'plan',
      spanId: span.id,
      reasoning: 'consuming old action',
      fromStep: 'coordinate',
      summary: 'new plan',
      removePendingId: 'old-action',
    });

    const pending = store.getPending();
    // Old one removed, new one added
    expect(pending).toHaveLength(1);
    expect(pending[0].action).toBe('plan');
  });

  it('does not remove anything when removePendingId is omitted', () => {
    const span = new SpanWriter('test', {
      step: 'test',
      parentId: null,
    });

    store.addPending({
      traceId: 'trace-1',
      actionId: 'existing',
      action: 'coordinate',
    });

    emitAction(store, {
      projectId: 'test',
      traceId: 'trace-1',
      action: 'plan',
      spanId: span.id,
      reasoning: 'test',
      fromStep: 'coordinate',
      summary: 'new',
    });

    expect(store.getPending()).toHaveLength(2);
  });
});
