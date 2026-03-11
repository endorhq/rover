import { launch } from 'rover-core';
import { ROVER_FOOTER_MARKER } from '../helpers.js';
import type { EventFetcher, EventKind, NormEvent, RepoInfo } from './types.js';

/** Raw shape returned by `gh api repos/{owner}/{repo}/events`. */
interface GHEvent {
  id: string;
  type: string;
  actor: { login: string };
  created_at: string;
  // biome-ignore lint/suspicious/noExplicitAny: GitHub event payloads are untyped JSON
  payload: Record<string, any>;
}

/** GitHub event fetcher using the `gh` CLI. */
export class GitHubFetcher implements EventFetcher {
  readonly source = 'github' as const;

  private botNameLower: string | null;

  constructor(opts?: { botName?: string }) {
    this.botNameLower = opts?.botName?.toLowerCase() ?? null;
  }

  async fetchEvents(repo: RepoInfo): Promise<NormEvent[]> {
    const result = await launch('gh', [
      'api',
      `repos/${repo.fullPath}/events?per_page=25`,
      '--jq',
      '.[] | {id, type, actor: {login: .actor.login}, created_at, payload}',
    ]);

    if (result.failed || !result.stdout) {
      throw new Error('gh api call failed');
    }

    const lines = result.stdout
      .toString()
      .trim()
      .split('\n')
      .filter(l => l.length > 0);

    const events: NormEvent[] = [];
    for (const line of lines) {
      const raw = JSON.parse(line) as GHEvent;
      if (
        this.botNameLower &&
        raw.actor.login.toLowerCase() === this.botNameLower
      )
        continue;
      const norm = this.normalize(raw);
      if (norm) events.push(norm);
    }
    return events;
  }

  async resolveActors(repo: RepoInfo, _mode: 'maintainers'): Promise<string[]> {
    const result = await launch('gh', [
      'api',
      `repos/${repo.fullPath}/collaborators`,
      '--jq',
      '.[].login',
    ]);

    if (result.failed || !result.stdout) return [];

    return result.stdout
      .toString()
      .trim()
      .split('\n')
      .filter(l => l.length > 0);
  }

  private normalize(event: GHEvent): NormEvent | null {
    const { type, payload, actor, id, created_at } = event;
    const base = {
      id,
      source: 'github' as const,
      actor: actor.login,
      createdAt: created_at,
    };

    switch (type) {
      case 'IssuesEvent': {
        const kind = mapIssueAction(payload.action);
        if (!kind) return null;
        return {
          ...base,
          kind,
          summary: `issue ${payload.action} #${payload.issue?.number}`,
          meta: {
            type,
            action: payload.action,
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
        const kind = mapPRAction(payload.action, payload.pull_request?.merged);
        if (!kind) return null;
        const label = kind === 'pr.merged' ? 'merged' : payload.action;
        return {
          ...base,
          kind,
          summary: `PR ${label} #${payload.pull_request?.number}`,
          meta: {
            type,
            action: payload.action,
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

      case 'IssueCommentEvent': {
        if (payload.action !== 'created') return null;
        if ((payload.comment?.body ?? '').includes(ROVER_FOOTER_MARKER))
          return null;
        return {
          ...base,
          kind: 'comment.created',
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
      }

      case 'PullRequestReviewEvent': {
        if (payload.action !== 'submitted') return null;
        if ((payload.review?.body ?? '').includes(ROVER_FOOTER_MARKER))
          return null;
        return {
          ...base,
          kind: 'pr.review_submitted',
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
      }

      case 'PullRequestReviewCommentEvent': {
        if (payload.action !== 'created') return null;
        if ((payload.comment?.body ?? '').includes(ROVER_FOOTER_MARKER))
          return null;
        return {
          ...base,
          kind: 'review_comment.created',
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
      }

      case 'PushEvent':
        return {
          ...base,
          kind: 'push',
          summary: `new push to ${payload.ref}`,
          meta: {
            type,
            ref: payload.ref,
            pusher: actor.login,
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
}

function mapIssueAction(action: string): EventKind | null {
  switch (action) {
    case 'opened':
      return 'issue.opened';
    case 'closed':
      return 'issue.closed';
    case 'reopened':
      return 'issue.reopened';
    default:
      return null;
  }
}

function mapPRAction(action: string, merged?: boolean): EventKind | null {
  if (action === 'closed' && merged) return 'pr.merged';
  switch (action) {
    case 'opened':
      return 'pr.opened';
    case 'closed':
      return 'pr.closed';
    case 'reopened':
      return 'pr.reopened';
    case 'ready_for_review':
      return 'pr.ready_for_review';
    case 'review_requested':
      return 'pr.review_requested';
    default:
      return null;
  }
}
