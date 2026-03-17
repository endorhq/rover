import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let projectDir: string;

vi.mock('rover-core', async () => {
  const actual =
    await vi.importActual<typeof import('rover-core')>('rover-core');
  return {
    ...actual,
    getProjectPath: () => projectDir,
    launch: vi.fn(),
  };
});

import { AutopilotStore } from '../../store.js';
import type { TraceItem, Span } from '../../types.js';
import type { MemoryStore } from '../store.js';
import {
  buildMemoryEntry,
  formatDailyEntry,
  recordTraceCompletion,
} from '../writer.js';

function makeSpan(overrides: Partial<Span> = {}): Span {
  return {
    id: 'span-1',
    version: '1.0',
    timestamp: new Date().toISOString(),
    step: 'coordinate',
    parent: null,
    status: 'completed',
    completed: new Date().toISOString(),
    summary: 'done',
    meta: {},
    originAction: null,
    newActions: [],
    ...overrides,
  };
}

function makeTrace(overrides: Partial<TraceItem> = {}): TraceItem {
  return {
    traceId: 'trace-1',
    summary: 'test trace',
    spanIds: [],
    nextActions: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('buildMemoryEntry', () => {
  let store: AutopilotStore;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'memory-writer-test-'));
    mkdirSync(join(projectDir, 'spans'), { recursive: true });
    store = new AutopilotStore('test');
    store.ensureDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('extracts event info from root span', () => {
    const rootSpan = makeSpan({
      id: 'root',
      meta: {
        action: 'issues.opened',
        issueNumber: 42,
        title: 'Fix bug',
        url: 'https://github.com/org/repo/issues/42',
      },
    });

    const trace = makeTrace({ traceId: 'trace-1' });
    const entry = buildMemoryEntry(trace, [rootSpan], store);

    expect(entry.eventSummary).toBe('issues.opened #42 "Fix bug"');
    expect(entry.traceId).toBe('trace-1');
    expect(entry.url).toBe('https://github.com/org/repo/issues/42');
  });

  it('uses trace summary when no title in root span meta', () => {
    const rootSpan = makeSpan({ meta: { action: 'push' } });
    const trace = makeTrace({ summary: 'fallback summary' });

    const entry = buildMemoryEntry(trace, [rootSpan], store);

    expect(entry.eventSummary).toBe('push "fallback summary"');
  });

  it('handles no event number gracefully', () => {
    const rootSpan = makeSpan({
      meta: { action: 'push', title: 'deploy' },
    });
    const trace = makeTrace();

    const entry = buildMemoryEntry(trace, [rootSpan], store);

    expect(entry.eventSummary).toBe('push "deploy"');
  });

  it('extracts files changed from commit spans', () => {
    const commitSpan = makeSpan({
      id: 'commit-span',
      step: 'commit',
      parent: 'root',
      meta: { filesChanged: ['src/a.ts', 'src/b.ts'] },
    });
    writeFileSync(
      join(projectDir, 'spans', 'commit-span.json'),
      JSON.stringify(commitSpan)
    );

    const trace = makeTrace({
      spanIds: ['commit-span'],
    });

    const entry = buildMemoryEntry(trace, [makeSpan()], store);

    expect(entry.filesChanged).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('prefers extra.prUrl over push span URL', () => {
    const pushSpan = makeSpan({
      id: 'push-span',
      step: 'push',
      parent: 'root',
      meta: { pullRequestUrl: 'https://github.com/org/repo/pull/10' },
    });
    writeFileSync(
      join(projectDir, 'spans', 'push-span.json'),
      JSON.stringify(pushSpan)
    );

    const trace = makeTrace({
      spanIds: ['push-span'],
    });

    const entry = buildMemoryEntry(trace, [makeSpan()], store, {
      prUrl: 'https://github.com/org/repo/pull/99',
    });

    expect(entry.url).toBe('https://github.com/org/repo/pull/99');
  });

  it('falls back to push span URL when no extra.prUrl', () => {
    const pushSpan = makeSpan({
      id: 'push-span',
      step: 'push',
      parent: 'root',
      meta: { pullRequestUrl: 'https://github.com/org/repo/pull/10' },
    });
    writeFileSync(
      join(projectDir, 'spans', 'push-span.json'),
      JSON.stringify(pushSpan)
    );

    const trace = makeTrace({
      spanIds: ['push-span'],
    });

    const entry = buildMemoryEntry(trace, [makeSpan()], store);

    expect(entry.url).toBe('https://github.com/org/repo/pull/10');
  });

  it('uses extra.summary when provided', () => {
    const entry = buildMemoryEntry(makeTrace(), [makeSpan()], store, {
      summary: 'AI-generated summary',
    });

    expect(entry.summary).toBe('AI-generated summary');
  });

  it('returns null summary when no extra.summary', () => {
    const entry = buildMemoryEntry(makeTrace(), [makeSpan()], store);

    expect(entry.summary).toBeNull();
  });

  it('handles empty spans array', () => {
    const trace = makeTrace();
    const entry = buildMemoryEntry(trace, [], store);

    expect(entry.eventSummary).toBe(' "test trace"');
    expect(entry.url).toBeNull();
  });
});

describe('formatDailyEntry', () => {
  it('formats a full entry with all fields', () => {
    const md = formatDailyEntry({
      timestamp: '14:30',
      eventSummary: 'issues.opened #42 "Fix bug"',
      traceId: 'trace-abc',
      summary: 'Fixed the memory leak in the parser',
      filesChanged: ['src/parser.ts', 'src/utils.ts'],
      url: 'https://github.com/org/repo/pull/10',
    });

    expect(md).toContain('## [14:30] issues.opened #42 "Fix bug"');
    expect(md).toContain('Fixed the memory leak in the parser');
    expect(md).toContain('- **Trace**: trace-abc');
    expect(md).toContain('- **Files changed**: src/parser.ts, src/utils.ts');
    expect(md).toContain(
      '- **Reference**: https://github.com/org/repo/pull/10'
    );
    expect(md).toContain('---');
  });

  it('omits summary when null', () => {
    const md = formatDailyEntry({
      timestamp: '09:00',
      eventSummary: 'noop',
      traceId: 'trace-1',
      summary: null,
      filesChanged: [],
      url: null,
    });

    expect(md).toContain('## [09:00] noop');
    expect(md).toContain('- **Trace**: trace-1');
    expect(md).not.toContain('**Files changed**');
    expect(md).not.toContain('**Reference**');
  });

  it('omits files changed when empty', () => {
    const md = formatDailyEntry({
      timestamp: '10:00',
      eventSummary: 'test',
      traceId: 'trace-1',
      summary: null,
      filesChanged: [],
      url: null,
    });

    expect(md).not.toContain('**Files changed**');
  });

  it('omits reference when url is null', () => {
    const md = formatDailyEntry({
      timestamp: '10:00',
      eventSummary: 'test',
      traceId: 'trace-1',
      summary: null,
      filesChanged: [],
      url: null,
    });

    expect(md).not.toContain('**Reference**');
  });
});

describe('recordTraceCompletion', () => {
  let store: AutopilotStore;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'memory-record-test-'));
    mkdirSync(join(projectDir, 'spans'), { recursive: true });
    store = new AutopilotStore('test');
    store.ensureDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('is a no-op when memoryStore is undefined', async () => {
    await recordTraceCompletion(undefined, makeTrace(), [makeSpan()], store);
    // Should not throw
  });

  it('appends entry and triggers update', async () => {
    const appendMock = vi.fn();
    const updateMock = vi.fn().mockResolvedValue(undefined);
    const memoryStore = {
      appendDailyEntry: appendMock,
      update: updateMock,
    } as unknown as MemoryStore;

    const rootSpan = makeSpan({
      meta: { action: 'issues.opened', title: 'Bug fix' },
    });

    await recordTraceCompletion(memoryStore, makeTrace(), [rootSpan], store);

    expect(appendMock).toHaveBeenCalledTimes(1);
    const written = appendMock.mock.calls[0][0] as string;
    expect(written).toContain('issues.opened');
    expect(written).toContain('Bug fix');
    expect(written).toContain('---');

    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});
