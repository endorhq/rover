import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  EventPoller,
  writeSpanAndAction,
  resolveAllowedActors,
} from '../events.js';
import { AutopilotStore } from '../store.js';
import type { EventFetcher, NormEvent, RepoInfo } from '../sources/types.js';

const repo: RepoInfo = {
  source: 'github',
  fullPath: 'owner/repo',
  owner: 'owner',
  repo: 'repo',
};

function makeEvent(overrides: Partial<NormEvent> = {}): NormEvent {
  return {
    id: 'evt-1',
    kind: 'issue.opened',
    source: 'github',
    actor: 'alice',
    createdAt: new Date().toISOString(),
    summary: 'issue opened #1',
    meta: { issueNumber: 1 },
    ...overrides,
  };
}

function makeFetcher(events: NormEvent[]): EventFetcher {
  return {
    source: 'github',
    fetchEvents: vi.fn().mockResolvedValue(events),
    resolveActors: vi.fn().mockResolvedValue(['alice', 'bob']),
  };
}

describe('EventPoller', () => {
  let store: AutopilotStore;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'autopilot-events-test-'));
    mkdirSync(join(projectDir, 'spans'), { recursive: true });
    mkdirSync(join(projectDir, 'actions'), { recursive: true });
    mkdirSync(join(projectDir, 'autopilot'), { recursive: true });
    store = new AutopilotStore('test');
    store.ensureDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('ingests new events into the store', async () => {
    const events = [
      makeEvent({ id: 'e1', summary: 'issue opened #1' }),
      makeEvent({ id: 'e2', summary: 'issue opened #2' }),
    ];
    const fetcher = makeFetcher(events);

    const poller = new EventPoller('test', store, fetcher, repo);

    const result = await poller.poll();
    expect(result.fetched).toBe(2);
    expect(result.new).toBe(2);

    // Events should be marked as processed
    expect(store.isEventProcessed('e1')).toBe(true);
    expect(store.isEventProcessed('e2')).toBe(true);
  });

  it('deduplicates events on second poll', async () => {
    const events = [makeEvent({ id: 'e1' })];
    const fetcher = makeFetcher(events);

    const poller = new EventPoller('test', store, fetcher, repo);

    const first = await poller.poll();
    expect(first.new).toBe(1);

    const second = await poller.poll();
    expect(second.fetched).toBe(1);
    expect(second.new).toBe(0);
  });

  it('filters events before fromDate', async () => {
    const old = makeEvent({
      id: 'e-old',
      createdAt: '2024-01-01T00:00:00Z',
    });
    const recent = makeEvent({
      id: 'e-new',
      createdAt: '2024-06-01T00:00:00Z',
    });
    const fetcher = makeFetcher([old, recent]);

    const poller = new EventPoller('test', store, fetcher, repo, {
      fromDate: new Date('2024-03-01T00:00:00Z'),
    });

    const result = await poller.poll();
    expect(result.fetched).toBe(2);
    expect(result.relevant).toBe(1);
    expect(result.new).toBe(1);
  });

  it('filters events by allowed actors', async () => {
    const events = [
      makeEvent({ id: 'e1', actor: 'alice' }),
      makeEvent({ id: 'e2', actor: 'eve' }),
      makeEvent({ id: 'e3', actor: 'bob' }),
    ];
    const fetcher = makeFetcher(events);

    const poller = new EventPoller('test', store, fetcher, repo, {
      allowedActors: new Set(['alice', 'bob']),
    });

    const result = await poller.poll();
    expect(result.new).toBe(2);
    expect(result.filtered).toBe(1);

    expect(store.isEventProcessed('e1')).toBe(true);
    expect(store.isEventProcessed('e2')).toBe(false);
    expect(store.isEventProcessed('e3')).toBe(true);
  });

  it('calls onNewEvents when events are ingested', async () => {
    const onNewEvents = vi.fn();
    const fetcher = makeFetcher([makeEvent({ id: 'e1' })]);

    const poller = new EventPoller('test', store, fetcher, repo, {
      onNewEvents,
    });

    await poller.poll();
    expect(onNewEvents).toHaveBeenCalledTimes(1);
  });

  it('does not call onNewEvents when no new events', async () => {
    const onNewEvents = vi.fn();
    const fetcher = makeFetcher([]);

    const poller = new EventPoller('test', store, fetcher, repo, {
      onNewEvents,
    });

    await poller.poll();
    expect(onNewEvents).not.toHaveBeenCalled();
  });

  it('start() and stop() manage the timer', async () => {
    vi.useFakeTimers();
    const fetcher = makeFetcher([]);

    const poller = new EventPoller('test', store, fetcher, repo, {
      pollIntervalMs: 1000,
    });

    poller.start();

    // Initial call
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher.fetchEvents).toHaveBeenCalledTimes(1);

    // Timer fires
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher.fetchEvents).toHaveBeenCalledTimes(2);

    poller.stop();

    // No more calls after stop
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetcher.fetchEvents).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});

describe('writeSpanAndAction', () => {
  let store: AutopilotStore;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'autopilot-write-test-'));
    mkdirSync(join(projectDir, 'spans'), { recursive: true });
    mkdirSync(join(projectDir, 'actions'), { recursive: true });
    mkdirSync(join(projectDir, 'autopilot'), { recursive: true });
    store = new AutopilotStore('test');
    store.ensureDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('creates a span file on disk', () => {
    const event = makeEvent({ id: 'e1', summary: 'issue opened #1' });
    const { spanId } = writeSpanAndAction('test', event, store);

    const spanPath = join(projectDir, 'spans', `${spanId}.json`);
    const span = JSON.parse(readFileSync(spanPath, 'utf8'));
    expect(span.step).toBe('event');
    expect(span.status).toBe('completed');
    expect(span.summary).toBe('issue opened #1');
    expect(span.parent).toBeNull();
  });

  it('creates an action file on disk', () => {
    const event = makeEvent({ id: 'e1' });
    const { actionId } = writeSpanAndAction('test', event, store);

    const actionPath = join(projectDir, 'actions', `${actionId}.json`);
    const action = JSON.parse(readFileSync(actionPath, 'utf8'));
    expect(action.action).toBe('coordinate');
  });

  it('enqueues a pending action in the store', () => {
    const event = makeEvent({ id: 'e1' });
    writeSpanAndAction('test', event, store);

    const pending = store.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].action).toBe('coordinate');
  });

  it('appends a log entry', () => {
    const event = makeEvent({ id: 'e1' });
    writeSpanAndAction('test', event, store);

    const logs = store.readLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].step).toBe('event');
    expect(logs[0].action).toBe('coordinate');
  });
});

describe('resolveAllowedActors', () => {
  it('returns null for "all"', async () => {
    const fetcher = makeFetcher([]);
    const result = await resolveAllowedActors('all', fetcher, repo);
    expect(result).toBeNull();
  });

  it('returns null for undefined', async () => {
    const fetcher = makeFetcher([]);
    const result = await resolveAllowedActors(undefined, fetcher, repo);
    expect(result).toBeNull();
  });

  it('calls fetcher.resolveActors for "maintainers"', async () => {
    const fetcher = makeFetcher([]);
    const result = await resolveAllowedActors('maintainers', fetcher, repo);
    expect(fetcher.resolveActors).toHaveBeenCalledWith(repo, 'maintainers');
    expect(result).toEqual(new Set(['alice', 'bob']));
  });

  it('parses comma-separated usernames (lowercased, trimmed)', async () => {
    const fetcher = makeFetcher([]);
    const result = await resolveAllowedActors(
      'Alice, Bob , Charlie',
      fetcher,
      repo
    );
    expect(result).toEqual(new Set(['alice', 'bob', 'charlie']));
  });

  it('ignores empty segments', async () => {
    const fetcher = makeFetcher([]);
    const result = await resolveAllowedActors('alice,,bob,', fetcher, repo);
    expect(result).toEqual(new Set(['alice', 'bob']));
  });
});
