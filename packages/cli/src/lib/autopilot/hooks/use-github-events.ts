import { useState, useEffect, useRef } from 'react';
import type { FetchStatus, LogEntry } from '../types.js';
import type { AutopilotStore } from '../store.js';
import {
  fetchEvents,
  filterRelevantEvents,
  filterByAllowedActors,
  resolveAllowedActors,
  writeSpanAndAction,
  POLL_INTERVAL_MS,
} from '../events.js';
import { getRepoInfo } from '../helpers.js';

function ts(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

export function useGitHubEvents(
  projectPath: string,
  projectId: string,
  store: AutopilotStore,
  onNewEvents?: () => void,
  fromDate?: Date,
  allowEvents?: string,
  maintainers?: string[]
): {
  status: FetchStatus;
  log: LogEntry | null;
} {
  const [status, setStatus] = useState<FetchStatus>('idle');
  const [log, setLog] = useState<LogEntry | null>(null);
  const repoRef = useRef(getRepoInfo(projectPath));
  const allowedActorsRef = useRef(
    resolveAllowedActors(allowEvents, maintainers)
  );

  const doFetchRef = useRef<() => Promise<void>>();
  doFetchRef.current = async () => {
    const repo = repoRef.current;
    if (!repo) {
      setStatus('error');
      setLog({ timestamp: ts(), message: 'GitHub: no repo info found' });
      return;
    }

    setStatus('fetching');
    try {
      const events = await fetchEvents(repo.owner, repo.repo);
      const relevant = filterRelevantEvents(events, fromDate);

      // Filter by allowed actors
      const { allowed: actorFiltered, filteredCount } = filterByAllowedActors(
        relevant,
        allowedActorsRef.current
      );

      // Deduplicate against cursor
      const newEvents = actorFiltered.filter(
        e => !store.isEventProcessed(e.id)
      );

      for (const event of newEvents) {
        writeSpanAndAction(projectId, event, store);
      }

      // Mark all new event IDs as processed
      if (newEvents.length > 0) {
        store.markEventsProcessed(newEvents.map(e => e.id));
        onNewEvents?.();
      }

      setStatus('done');
      const filterSuffix =
        filteredCount > 0 ? `, ${filteredCount} filtered by allow-events` : '';
      setLog({
        timestamp: ts(),
        message: `GitHub: ${newEvents.length} new events (${actorFiltered.length} allowed, ${events.length} fetched${filterSuffix})`,
      });
    } catch {
      setStatus('error');
      setLog({ timestamp: ts(), message: 'GitHub: failed to fetch events' });
    }
  };

  // Initial fetch + interval — runs once, uses ref to always call latest logic
  useEffect(() => {
    doFetchRef.current?.();
    const timer = setInterval(() => doFetchRef.current?.(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return { status, log };
}
