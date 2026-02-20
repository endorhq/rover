import { useState, useEffect, useRef, useCallback } from 'react';
import { randomUUID } from 'node:crypto';
import { launch } from 'rover-core';
import type { FetchStatus, GitHubEvent } from './types.js';
import type { AutopilotStore } from './store.js';
import { SpanWriter, ActionWriter, enqueueAction } from './logging.js';
import { getRepoInfo } from './helpers.js';

const POLL_INTERVAL_MS = 60_000; // 1 minute

async function fetchEvents(
  owner: string,
  repo: string
): Promise<GitHubEvent[]> {
  const result = await launch('gh', [
    'api',
    `repos/${owner}/${repo}/events?per_page=25`,
    '--jq',
    '.[] | {id, type, actor: {login: .actor.login}, created_at, payload}',
  ]);

  if (result.failed || !result.stdout) {
    throw new Error('gh api call failed');
  }

  // gh --jq outputs one JSON object per line (not an array)
  const lines = result.stdout
    .toString()
    .trim()
    .split('\n')
    .filter(l => l.length > 0);

  return lines.map(line => JSON.parse(line) as GitHubEvent);
}

interface RelevantEvent {
  summary: string;
  meta: Record<string, any>;
}

function extractRelevantEvent(event: GitHubEvent): RelevantEvent | null {
  const { type, payload } = event;

  switch (type) {
    case 'IssuesEvent': {
      const issueAction = payload.action;
      if (!['opened', 'closed', 'reopened'].includes(issueAction)) return null;
      return {
        summary: `issue ${issueAction} #${payload.issue?.number}`,
        meta: {
          type,
          action: issueAction,
          issueNumber: payload.issue?.number,
          title: payload.issue?.title,
          state: payload.issue?.state,
          author: payload.issue?.user?.login,
          labels: (payload.issue?.labels ?? []).map(
            (l: { name: string }) => l.name
          ),
          assignees: (payload.issue?.assignees ?? []).map(
            (a: { login: string }) => a.login
          ),
          url: payload.issue?.html_url,
        },
      };
    }

    case 'PullRequestEvent': {
      const prAction = payload.action;
      if (
        ![
          'opened',
          'closed',
          'reopened',
          'ready_for_review',
          'review_requested',
        ].includes(prAction)
      )
        return null;
      return {
        summary: `PR ${prAction} #${payload.pull_request?.number}`,
        meta: {
          type,
          action: prAction,
          prNumber: payload.pull_request?.number,
          title: payload.pull_request?.title,
          state: payload.pull_request?.state,
          draft: payload.pull_request?.draft ?? false,
          merged: payload.pull_request?.merged ?? false,
          author: payload.pull_request?.user?.login,
          branch: payload.pull_request?.head?.ref,
          baseBranch: payload.pull_request?.base?.ref,
          labels: (payload.pull_request?.labels ?? []).map(
            (l: { name: string }) => l.name
          ),
          assignees: (payload.pull_request?.assignees ?? []).map(
            (a: { login: string }) => a.login
          ),
          requestedReviewers: (
            payload.pull_request?.requested_reviewers ?? []
          ).map((r: { login: string }) => r.login),
          additions: payload.pull_request?.additions,
          deletions: payload.pull_request?.deletions,
          changedFiles: payload.pull_request?.changed_files,
          url: payload.pull_request?.html_url,
        },
      };
    }

    case 'IssueCommentEvent':
      if (payload.action !== 'created') return null;
      return {
        summary: `new comment on #${payload.issue?.number}`,
        meta: {
          type,
          issueNumber: payload.issue?.number,
          issueTitle: payload.issue?.title,
          issueState: payload.issue?.state,
          isPullRequest: !!payload.issue?.pull_request,
          author: payload.comment?.user?.login,
          commentId: payload.comment?.id,
          body: (payload.comment?.body ?? '').slice(0, 200),
        },
      };

    case 'PullRequestReviewEvent':
      if (payload.action !== 'submitted') return null;
      return {
        summary: `new review on PR #${payload.pull_request?.number}`,
        meta: {
          type,
          prNumber: payload.pull_request?.number,
          prTitle: payload.pull_request?.title,
          prState: payload.pull_request?.state,
          prMerged: payload.pull_request?.merged ?? false,
          reviewer: payload.review?.user?.login,
          state: payload.review?.state,
          body: payload.review?.body ?? '',
        },
      };

    case 'PullRequestReviewCommentEvent':
      if (payload.action !== 'created') return null;
      return {
        summary: `new review comment on PR #${payload.pull_request?.number}`,
        meta: {
          type,
          prNumber: payload.pull_request?.number,
          prTitle: payload.pull_request?.title,
          prState: payload.pull_request?.state,
          prMerged: payload.pull_request?.merged ?? false,
          author: payload.comment?.user?.login,
          commentId: payload.comment?.id,
          path: payload.comment?.path,
          body: (payload.comment?.body ?? '').slice(0, 200),
        },
      };

    case 'PushEvent':
      return {
        summary: `new push to ${payload.ref}`,
        meta: {
          type,
          ref: payload.ref,
          pusher: event.actor.login,
          commitCount: payload.size ?? payload.commits?.length ?? 0,
          headSha: payload.head,
          commits: (payload.commits ?? []).map(
            (c: { sha: string; message: string }) => ({
              sha: c.sha,
              message: c.message,
            })
          ),
        },
      };

    default:
      return null;
  }
}

export function filterRelevantEvents(
  events: GitHubEvent[]
): Array<GitHubEvent & RelevantEvent> {
  const results: Array<GitHubEvent & RelevantEvent> = [];
  for (const event of events) {
    const relevant = extractRelevantEvent(event);
    if (relevant) {
      results.push({ ...event, ...relevant });
    }
  }
  return results;
}

export function writeSpanAndAction(
  projectId: string,
  event: GitHubEvent & RelevantEvent,
  store: AutopilotStore
): { spanId: string; actionId: string; traceId: string } {
  const traceId = randomUUID();

  // Event span — root of the trace, completed immediately
  const span = new SpanWriter(projectId, {
    step: 'event',
    parentId: null,
    meta: event.meta,
  });
  span.complete(event.summary);

  // Coordinate action — tells the coordinator to decide what to do
  const action = new ActionWriter(projectId, {
    action: 'coordinate',
    spanId: span.id,
    reasoning: 'Needs to take a decision about what to do with this event',
    meta: event.meta,
  });

  enqueueAction(store, {
    traceId,
    action,
    step: 'event',
    summary: event.summary,
  });

  return { spanId: span.id, actionId: action.id, traceId };
}

export function useGitHubEvents(
  projectPath: string,
  projectId: string,
  store: AutopilotStore,
  onNewEvents?: () => void
): {
  status: FetchStatus;
  countdown: number;
  lastFetchCount: number;
  lastRelevantCount: number;
  lastNewCount: number;
} {
  const [status, setStatus] = useState<FetchStatus>('idle');
  const [countdown, setCountdown] = useState(POLL_INTERVAL_MS / 1000);
  const [lastFetchCount, setLastFetchCount] = useState(0);
  const [lastRelevantCount, setLastRelevantCount] = useState(0);
  const [lastNewCount, setLastNewCount] = useState(0);
  const repoRef = useRef(getRepoInfo(projectPath));

  const doFetch = useCallback(async () => {
    const repo = repoRef.current;
    if (!repo) {
      setStatus('error');
      return;
    }

    setStatus('fetching');
    try {
      const events = await fetchEvents(repo.owner, repo.repo);
      const relevant = filterRelevantEvents(events);

      // Deduplicate against cursor
      const newEvents = relevant.filter(e => !store.isEventProcessed(e.id));

      for (const event of newEvents) {
        writeSpanAndAction(projectId, event, store);
      }

      // Mark all new event IDs as processed
      if (newEvents.length > 0) {
        store.markEventsProcessed(newEvents.map(e => e.id));
        onNewEvents?.();
      }

      setLastFetchCount(events.length);
      setLastRelevantCount(relevant.length);
      setLastNewCount(newEvents.length);
      setStatus('done');
    } catch {
      setStatus('error');
    }

    // Reset countdown after fetch completes
    setCountdown(POLL_INTERVAL_MS / 1000);
  }, [projectId, store, onNewEvents]);

  // Initial fetch + interval
  useEffect(() => {
    doFetch();
    const timer = setInterval(doFetch, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [doFetch]);

  // Countdown ticker (every second)
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  return { status, countdown, lastFetchCount, lastRelevantCount, lastNewCount };
}
