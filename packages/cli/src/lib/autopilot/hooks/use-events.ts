import { useState, useEffect, useRef } from 'react';
import type { FetchStatus, LogEntry } from '../types.js';
import type { AutopilotStore } from '../store.js';
import { getRepoInfo } from '../sources/detect.js';
import {
  EventPoller,
  POLL_INTERVAL_MS,
  resolveAllowedActors,
} from '../events.js';
import { GitHubFetcher } from '../sources/github.js';
import { GitLabFetcher } from '../sources/gitlab.js';
import type { EventFetcher } from '../sources/types.js';

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

function createFetcher(
  source: 'github' | 'gitlab',
  cwd: string,
  botName?: string
): EventFetcher {
  if (source === 'gitlab') return new GitLabFetcher(cwd, { botName });
  return new GitHubFetcher({ botName });
}

export function useEvents(opts: {
  projectPath: string;
  projectId: string;
  store: AutopilotStore;
  onNewEvents?: () => void;
  fromDate?: Date;
  allowEvents?: string;
  botName?: string;
}): {
  status: FetchStatus;
  log: LogEntry | null;
} {
  const [status, setStatus] = useState<FetchStatus>('idle');
  const [log, setLog] = useState<LogEntry | null>(null);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let cancelled = false;
    let poller: EventPoller | null = null;

    async function init() {
      const {
        projectPath,
        projectId,
        store,
        onNewEvents,
        fromDate,
        allowEvents,
        botName,
      } = optsRef.current;

      const repo = await getRepoInfo(projectPath);
      if (!repo) {
        setStatus('error');
        setLog({ timestamp: ts(), message: 'Events: no repo info found' });
        return;
      }

      const fetcher = createFetcher(repo.source, projectPath, botName);

      let allowedActors: Set<string> | null = null;
      try {
        allowedActors = await resolveAllowedActors(allowEvents, fetcher, repo);
      } catch {
        // If resolving actors fails, proceed without filtering
      }

      if (cancelled) return;

      poller = new EventPoller(projectId, store, fetcher, repo, {
        pollIntervalMs: POLL_INTERVAL_MS,
        fromDate,
        allowedActors,
        onNewEvents: () => {
          onNewEvents?.();
        },
      });

      // Run poll cycles manually so we can update status/log
      const doPoll = async () => {
        if (cancelled) return;
        setStatus('fetching');
        try {
          const result = await poller?.poll();
          if (cancelled || !result) return;
          setStatus('done');
          const filterSuffix =
            result.filtered > 0
              ? `, ${result.filtered} filtered by allow-events`
              : '';
          setLog({
            timestamp: ts(),
            message: `${repo.source}: ${result.new} new events (${result.relevant} relevant, ${result.fetched} fetched${filterSuffix})`,
          });
        } catch {
          if (cancelled) return;
          setStatus('error');
          setLog({
            timestamp: ts(),
            message: `${repo.source}: failed to fetch events`,
          });
        }
      };

      doPoll();
      const timer = setInterval(doPoll, POLL_INTERVAL_MS);

      return () => {
        clearInterval(timer);
      };
    }

    let cleanupTimer: (() => void) | undefined;
    init().then(cleanup => {
      cleanupTimer = cleanup;
    });

    return () => {
      cancelled = true;
      poller?.stop();
      cleanupTimer?.();
    };
  }, []);

  return { status, log };
}
