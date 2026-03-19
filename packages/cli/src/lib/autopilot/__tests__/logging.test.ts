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

import { ActionWriter, SpanWriter } from '../logging.js';

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

  it('does not duplicate when linked twice via separate actions', () => {
    const span = new SpanWriter('test', {
      step: 'test',
      parentId: null,
    });

    const action1 = new ActionWriter('test', {
      action: 'plan',
      spanId: span.id,
      reasoning: 'first',
    });

    const action2 = new ActionWriter('test', {
      action: 'notify',
      spanId: span.id,
      reasoning: 'second',
    });

    const spanData = readSpanFile(span.id);
    expect(spanData.newActions).toContain(action1.id);
    expect(spanData.newActions).toContain(action2.id);
    expect(spanData.newActions).toHaveLength(2);
  });

  it('handles missing parent span gracefully', () => {
    // Should not throw when the span file doesn't exist
    const action = new ActionWriter('test', {
      action: 'plan',
      spanId: 'nonexistent-span',
      reasoning: 'test',
    });

    expect(action.id).toBeDefined();
  });
});
