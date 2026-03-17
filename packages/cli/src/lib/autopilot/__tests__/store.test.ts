import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  existsSync,
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

import { AutopilotStore } from '../store.js';
import type {
  TraceItem,
  AutopilotLogEntry,
  PendingAction,
  Span,
  WaitEntry,
} from '../types.js';

function makePending(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    traceId: 'trace-1',
    actionId: overrides.actionId ?? 'action-1',
    action: 'plan',
    ...overrides,
  };
}

function makeLogEntry(
  overrides: Partial<AutopilotLogEntry> = {}
): AutopilotLogEntry {
  return {
    ts: new Date().toISOString(),
    traceId: 'trace-1',
    spanId: 'span-1',
    actionId: 'action-1',
    step: 'coordinate',
    action: 'plan',
    summary: 'test',
    ...overrides,
  };
}

function makeWaitEntry(overrides: Partial<WaitEntry> = {}): WaitEntry {
  return {
    traceId: 'trace-1',
    actionId: overrides.actionId ?? 'action-1',
    spanId: 'span-1',
    waitingFor: 'task_complete',
    resumeAction: 'commit',
    resumeMeta: {},
    eventSummary: 'waiting for task',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('AutopilotStore', () => {
  let store: AutopilotStore;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'autopilot-store-test-'));
    store = new AutopilotStore('test-project');
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  describe('ensureDir', () => {
    it('creates the autopilot directory and default files', () => {
      store.ensureDir();

      const basePath = join(projectDir, 'autopilot');
      expect(existsSync(basePath)).toBe(true);
      expect(existsSync(join(basePath, 'cursor.json'))).toBe(true);
      expect(existsSync(join(basePath, 'state.json'))).toBe(true);
    });

    it('does not overwrite existing files', () => {
      store.ensureDir();
      store.markEventsProcessed(['evt-1']);
      store.ensureDir();

      expect(store.isEventProcessed('evt-1')).toBe(true);
    });
  });

  describe('cursor', () => {
    beforeEach(() => store.ensureDir());

    it('loads the default cursor', () => {
      const cursor = store.loadCursor();
      expect(cursor.version).toBe('1.0');
      expect(cursor.processedEventIds).toEqual([]);
    });

    it('saves and loads a cursor round-trip', () => {
      const cursor = store.loadCursor();
      cursor.processedEventIds.push('evt-1', 'evt-2');
      store.saveCursor(cursor);

      const loaded = store.loadCursor();
      expect(loaded.processedEventIds).toEqual(['evt-1', 'evt-2']);
      expect(loaded.updatedAt).toBeDefined();
    });

    it('returns a default cursor when the file is missing', () => {
      rmSync(join(projectDir, 'autopilot', 'cursor.json'));
      const cursor = store.loadCursor();
      expect(cursor.processedEventIds).toEqual([]);
    });
  });

  describe('isEventProcessed / markEventsProcessed', () => {
    beforeEach(() => store.ensureDir());

    it('reports false for unknown events', () => {
      expect(store.isEventProcessed('unknown')).toBe(false);
    });

    it('reports true after marking an event', () => {
      store.markEventsProcessed(['evt-1']);
      expect(store.isEventProcessed('evt-1')).toBe(true);
    });

    it('caps processed IDs at 200 entries', () => {
      const ids = Array.from({ length: 210 }, (_, i) => `evt-${i}`);
      store.markEventsProcessed(ids);

      const cursor = store.loadCursor();
      expect(cursor.processedEventIds).toHaveLength(200);
      // Oldest entries evicted, newest kept
      expect(cursor.processedEventIds[0]).toBe('evt-10');
      expect(cursor.processedEventIds[199]).toBe('evt-209');
    });
  });

  describe('state', () => {
    beforeEach(() => store.ensureDir());

    it('loads the default state', () => {
      const state = store.loadState();
      expect(state.version).toBe('1.0');
      expect(state.pending).toEqual([]);
    });

    it('returns a default state when the file is missing', () => {
      rmSync(join(projectDir, 'autopilot', 'state.json'));
      const state = store.loadState();
      expect(state.pending).toEqual([]);
    });
  });

  describe('pending queue', () => {
    beforeEach(() => store.ensureDir());

    it('adds and retrieves pending actions', () => {
      const entry = makePending({ actionId: 'a-1' });
      store.addPending(entry);

      const pending = store.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].actionId).toBe('a-1');
    });

    it('adds multiple pending actions', () => {
      store.addPending(makePending({ actionId: 'a-1' }));
      store.addPending(makePending({ actionId: 'a-2' }));

      expect(store.getPending()).toHaveLength(2);
    });

    it('removes a pending action by action ID', () => {
      store.addPending(makePending({ actionId: 'a-1' }));
      store.addPending(makePending({ actionId: 'a-2' }));
      store.removePending('a-1');

      const pending = store.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].actionId).toBe('a-2');
    });

    it('removing a non-existent ID is a no-op', () => {
      store.addPending(makePending({ actionId: 'a-1' }));
      store.removePending('does-not-exist');

      expect(store.getPending()).toHaveLength(1);
    });
  });

  describe('task mappings', () => {
    beforeEach(() => store.ensureDir());

    it('stores and retrieves a task mapping', () => {
      store.setTaskMapping('action-1', {
        taskId: 42,
        branchName: 'feature/test',
      });

      const mapping = store.getTaskMapping('action-1');
      expect(mapping).toEqual({
        taskId: 42,
        branchName: 'feature/test',
      });
    });

    it('returns undefined for missing mappings', () => {
      expect(store.getTaskMapping('unknown')).toBeUndefined();
    });

    it('returns all task mappings', () => {
      store.setTaskMapping('a-1', { taskId: 1, branchName: 'branch-1' });
      store.setTaskMapping('a-2', { taskId: 2, branchName: 'branch-2' });

      const all = store.getAllTaskMappings();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all['a-1'].taskId).toBe(1);
      expect(all['a-2'].taskId).toBe(2);
    });

    it('returns empty object when no mappings exist', () => {
      expect(store.getAllTaskMappings()).toEqual({});
    });
  });

  describe('wait queue', () => {
    beforeEach(() => store.ensureDir());

    it('adds and retrieves wait entries', () => {
      const entry = makeWaitEntry({ actionId: 'w-1' });
      store.addWaitEntry(entry);

      const queue = store.getWaitQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].actionId).toBe('w-1');
    });

    it('removes a wait entry by action ID', () => {
      store.addWaitEntry(makeWaitEntry({ actionId: 'w-1' }));
      store.addWaitEntry(makeWaitEntry({ actionId: 'w-2' }));
      store.removeWaitEntry('w-1');

      const queue = store.getWaitQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].actionId).toBe('w-2');
    });

    it('returns an empty array when no wait queue exists', () => {
      expect(store.getWaitQueue()).toEqual([]);
    });

    it('removeWaitEntry is a no-op when waitQueue is undefined', () => {
      // State has no waitQueue field at all
      store.removeWaitEntry('w-1');
      expect(store.getWaitQueue()).toEqual([]);
    });
  });

  describe('audit log', () => {
    beforeEach(() => store.ensureDir());

    it('appends and reads log entries', () => {
      store.appendLog(makeLogEntry({ summary: 'first' }));
      store.appendLog(makeLogEntry({ summary: 'second' }));

      const logs = store.readLogs();
      expect(logs).toHaveLength(2);
      expect(logs[0].summary).toBe('first');
      expect(logs[1].summary).toBe('second');
    });

    it('returns empty array when no log file exists', () => {
      expect(store.readLogs()).toEqual([]);
    });

    it('respects maxEntries limit', () => {
      for (let i = 0; i < 10; i++) {
        store.appendLog(makeLogEntry({ summary: `entry-${i}` }));
      }

      const logs = store.readLogs(3);
      expect(logs).toHaveLength(3);
      // Returns the last 3 entries
      expect(logs[0].summary).toBe('entry-7');
      expect(logs[2].summary).toBe('entry-9');
    });

    it('skips malformed lines', () => {
      const logPath = join(projectDir, 'autopilot', 'log.jsonl');
      writeFileSync(
        logPath,
        `${JSON.stringify(makeLogEntry({ summary: 'good' }))}\nBAD LINE\n${JSON.stringify(makeLogEntry({ summary: 'good again' }))}\n`,
        'utf8'
      );

      const logs = store.readLogs();
      expect(logs).toHaveLength(2);
      expect(logs[0].summary).toBe('good');
      expect(logs[1].summary).toBe('good again');
    });
  });

  describe('log rotation', () => {
    beforeEach(() => store.ensureDir());

    it('does not rotate when log is under 5 MB', () => {
      store.appendLog(makeLogEntry());
      store.rotateIfNeeded();

      expect(existsSync(join(projectDir, 'autopilot', 'log.1.jsonl'))).toBe(
        false
      );
    });

    it('rotates the log file when it exceeds 5 MB', () => {
      const logPath = join(projectDir, 'autopilot', 'log.jsonl');
      // Write 5 MB + 1 byte to trigger rotation
      writeFileSync(logPath, 'x'.repeat(5 * 1024 * 1024 + 1), 'utf8');

      store.rotateIfNeeded();

      expect(existsSync(logPath)).toBe(false);
      expect(existsSync(join(projectDir, 'autopilot', 'log.1.jsonl'))).toBe(
        true
      );
    });

    it('cascades rotated files (log.1 → log.2)', () => {
      const basePath = join(projectDir, 'autopilot');
      const logPath = join(basePath, 'log.jsonl');

      writeFileSync(join(basePath, 'log.1.jsonl'), 'old-1', 'utf8');
      writeFileSync(logPath, 'x'.repeat(5 * 1024 * 1024 + 1), 'utf8');

      store.rotateIfNeeded();

      expect(readFileSync(join(basePath, 'log.2.jsonl'), 'utf8')).toBe('old-1');
      expect(existsSync(join(basePath, 'log.1.jsonl'))).toBe(true);
    });

    it('deletes the oldest rotated file at max capacity', () => {
      const basePath = join(projectDir, 'autopilot');
      const logPath = join(basePath, 'log.jsonl');

      writeFileSync(join(basePath, 'log.1.jsonl'), 'r1', 'utf8');
      writeFileSync(join(basePath, 'log.2.jsonl'), 'r2', 'utf8');
      writeFileSync(join(basePath, 'log.3.jsonl'), 'r3-oldest', 'utf8');
      writeFileSync(logPath, 'x'.repeat(5 * 1024 * 1024 + 1), 'utf8');

      store.rotateIfNeeded();

      // log.3 was deleted (max), log.2 was from log.1, log.1 was from log.jsonl
      const r3 = readFileSync(join(basePath, 'log.3.jsonl'), 'utf8');
      expect(r3).toBe('r2');
    });

    it('reads entries across rotated files', () => {
      const basePath = join(projectDir, 'autopilot');
      writeFileSync(
        join(basePath, 'log.1.jsonl'),
        `${JSON.stringify(makeLogEntry({ summary: 'rotated' }))}\n`,
        'utf8'
      );
      store.appendLog(makeLogEntry({ summary: 'current' }));

      const logs = store.readLogs();
      expect(logs).toHaveLength(2);
      expect(logs[0].summary).toBe('rotated');
      expect(logs[1].summary).toBe('current');
    });
  });

  describe('span reading', () => {
    beforeEach(() => {
      store.ensureDir();
      mkdirSync(join(projectDir, 'spans'), { recursive: true });
    });

    it('reads a span from disk', () => {
      const span: Span = {
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
      };
      writeFileSync(
        join(projectDir, 'spans', 'span-1.json'),
        JSON.stringify(span)
      );

      const loaded = store.readSpan('span-1');
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe('span-1');
      expect(loaded?.step).toBe('coordinate');
    });

    it('returns null for a missing span', () => {
      expect(store.readSpan('missing')).toBeNull();
    });
  });

  describe('getSpanTrace', () => {
    beforeEach(() => {
      store.ensureDir();
      mkdirSync(join(projectDir, 'spans'), { recursive: true });
    });

    function writeSpan(id: string, parent: string | null) {
      const span: Span = {
        id,
        version: '1.0',
        timestamp: new Date().toISOString(),
        step: 'test',
        parent,
        status: 'completed',
        completed: new Date().toISOString(),
        summary: `span ${id}`,
        meta: {},
        originAction: null,
        newActions: [],
      };
      writeFileSync(
        join(projectDir, 'spans', `${id}.json`),
        JSON.stringify(span)
      );
    }

    it('walks parent pointers to build root-first trace', () => {
      writeSpan('root', null);
      writeSpan('child', 'root');
      writeSpan('grandchild', 'child');

      const trace = store.getSpanTrace('grandchild');
      expect(trace).toHaveLength(3);
      expect(trace[0].id).toBe('root');
      expect(trace[1].id).toBe('child');
      expect(trace[2].id).toBe('grandchild');
    });

    it('returns partial trace when a parent is missing', () => {
      writeSpan('child', 'missing-root');

      const trace = store.getSpanTrace('child');
      expect(trace).toHaveLength(1);
      expect(trace[0].id).toBe('child');
    });

    it('returns empty array for a missing span', () => {
      expect(store.getSpanTrace('missing')).toEqual([]);
    });
  });

  describe('action reading', () => {
    beforeEach(() => {
      store.ensureDir();
      mkdirSync(join(projectDir, 'actions'), { recursive: true });
    });

    it('reads an action from disk', () => {
      const action = {
        id: 'action-1',
        version: '1.0',
        action: 'plan',
        timestamp: new Date().toISOString(),
        spanId: 'span-1',
        meta: {},
        reasoning: 'because',
      };
      writeFileSync(
        join(projectDir, 'actions', 'action-1.json'),
        JSON.stringify(action)
      );

      const loaded = store.readAction('action-1');
      expect(loaded).not.toBeNull();
      expect(loaded?.action).toBe('plan');
    });

    it('returns null for a missing action', () => {
      expect(store.readAction('missing')).toBeNull();
    });
  });

  describe('traces', () => {
    beforeEach(() => store.ensureDir());

    it('saves and loads traces round-trip', () => {
      const traces = new Map<string, TraceItem>();
      traces.set('t-1', {
        traceId: 't-1',
        summary: 'test trace',
        spanIds: [],
        nextActions: [],
        createdAt: new Date().toISOString(),
      });

      store.saveTraces(traces);

      const loaded = store.loadTraces();
      expect(loaded.size).toBe(1);
      expect(loaded.get('t-1')?.summary).toBe('test trace');
    });

    it('returns an empty map when traces file is missing', () => {
      expect(store.loadTraces().size).toBe(0);
    });
  });
});
