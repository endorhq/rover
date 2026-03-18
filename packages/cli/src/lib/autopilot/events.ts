import { randomUUID } from 'node:crypto';
import type { AutopilotStore } from './store.js';
import { SpanWriter, ActionWriter, enqueueAction } from './logging.js';
import type {
  EventFetcher,
  FetchStopCondition,
  NormEvent,
  RepoInfo,
} from './sources/types.js';

export const POLL_INTERVAL_MS = 60_000; // 1 minute

export interface PollResult {
  fetched: number;
  relevant: number;
  new: number;
  filtered: number;
}

export interface EventPollerOpts {
  pollIntervalMs?: number;
  fromDate?: Date;
  allowedActors?: Set<string> | null;
  onNewEvents?: () => void;
}

/**
 * Polls a platform fetcher on a timer, filters events, deduplicates
 * against the store's cursor, and writes spans + actions for new events.
 */
export class EventPoller {
  private projectId: string;
  private store: AutopilotStore;
  private fetcher: EventFetcher;
  private repo: RepoInfo;
  private opts: EventPollerOpts;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    projectId: string,
    store: AutopilotStore,
    fetcher: EventFetcher,
    repo: RepoInfo,
    opts?: EventPollerOpts
  ) {
    this.projectId = projectId;
    this.store = store;
    this.fetcher = fetcher;
    this.repo = repo;
    this.opts = opts ?? {};
  }

  /** Start polling: initial fetch + recurring interval. */
  start(): void {
    this.poll();
    this.timer = setInterval(
      () => this.poll(),
      this.opts.pollIntervalMs ?? POLL_INTERVAL_MS
    );
  }

  /** Stop the polling interval. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run a single poll cycle. Public for testing. */
  async poll(): Promise<PollResult> {
    const { fromDate, allowedActors, onNewEvents } = this.opts;

    // 1. Build stop condition for the fetcher (pagination + date + cursor)
    const stop: FetchStopCondition = {
      isProcessed: (id: string) => this.store.isEventProcessed(id),
      fromDate,
    };

    // 2. Fetch events — fetcher handles pagination, date cutoff, bot filtering, and cursor stop
    const fetched = await this.fetcher.fetchEvents(this.repo, stop);

    // 3. Allowed actor filter (doesn't affect pagination, stays here)
    let filtered = 0;
    let actorFiltered: NormEvent[];
    if (allowedActors) {
      actorFiltered = [];
      for (const e of fetched) {
        if (allowedActors.has(e.actor.toLowerCase())) {
          actorFiltered.push(e);
        } else {
          filtered++;
        }
      }
    } else {
      actorFiltered = fetched;
    }

    // 4. Write spans and actions
    for (const event of actorFiltered) {
      writeSpanAndAction(this.projectId, event, this.store);
    }

    // 5. Mark processed
    if (actorFiltered.length > 0) {
      this.store.markEventsProcessed(actorFiltered.map(e => e.id));
      onNewEvents?.();
    }

    return {
      fetched: fetched.length,
      relevant: fetched.length,
      new: actorFiltered.length,
      filtered,
    };
  }
}

/**
 * Create a root "event" span (completed immediately) and a "coordinate"
 * action for the pipeline to process.
 */
export function writeSpanAndAction(
  projectId: string,
  event: NormEvent,
  store: AutopilotStore
): { spanId: string; actionId: string; traceId: string } {
  const traceId = randomUUID();

  // Event span — root of the trace, completed immediately
  const span = new SpanWriter(projectId, {
    step: 'event',
    parentId: null,
    originAction: null,
    meta: event.meta,
  });
  span.complete(event.summary);

  // Coordinate action — tells the coordinator to decide what to do
  const action = new ActionWriter(projectId, {
    action: 'coordinate',
    spanId: span.id,
    reasoning: 'Needs to take a decision about what to do with this event',
    meta: { ...event.meta, eventSpanId: span.id },
  });

  enqueueAction(store, {
    traceId,
    action,
    step: 'event',
    summary: event.summary,
  });

  return { spanId: span.id, actionId: action.id, traceId };
}

/**
 * Resolve an --allow-events value into a set of lowercase actor logins,
 * or null when every actor is allowed.
 */
export async function resolveAllowedActors(
  allowEvents: string | undefined,
  fetcher: EventFetcher,
  repo: RepoInfo
): Promise<Set<string> | null> {
  if (!allowEvents || allowEvents === 'all') return null;

  if (allowEvents === 'maintainers') {
    const actors = await fetcher.resolveActors(repo, 'maintainers');
    if (actors.length === 0) return new Set();
    return new Set(actors.map(m => m.toLowerCase()));
  }

  // Comma-separated usernames
  const names = allowEvents
    .split(',')
    .map(n => n.trim().toLowerCase())
    .filter(n => n.length > 0);
  return new Set(names);
}
