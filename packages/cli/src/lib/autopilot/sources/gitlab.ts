import { launch } from 'rover-core';
import { ROVER_FOOTER_MARKER } from '../helpers.js';
import type { EventFetcher, EventKind, NormEvent, RepoInfo } from './types.js';

/** Raw shape returned by `glab api projects/:id/events`. */
interface GLEvent {
  id: number;
  action_name: string;
  target_type: string | null;
  target_id: number | null;
  target_title: string | null;
  author: { username: string };
  created_at: string;
  note?: { body: string; system?: boolean };
  push_data?: {
    ref: string;
    ref_type: string;
    commit_count: number;
    commit_title: string;
    commit_to: string;
  };
  target_iid?: number;
}

/** GitLab event fetcher using the `glab` CLI. */
export class GitLabFetcher implements EventFetcher {
  readonly source = 'gitlab' as const;

  private cwd: string;
  private botNameLower: string | null;

  constructor(cwd: string, opts?: { botName?: string }) {
    this.cwd = cwd;
    this.botNameLower = opts?.botName?.toLowerCase() ?? null;
  }

  async fetchEvents(_repo: RepoInfo): Promise<NormEvent[]> {
    const result = await launch(
      'glab',
      ['api', 'projects/:id/events?per_page=25'],
      { cwd: this.cwd }
    );

    if (result.failed || !result.stdout) {
      throw new Error('glab api call failed');
    }

    const raw = JSON.parse(result.stdout.toString()) as GLEvent[];

    const events: NormEvent[] = [];
    for (const entry of raw) {
      if (
        this.botNameLower &&
        entry.author.username.toLowerCase() === this.botNameLower
      )
        continue;
      const norm = await this.normalize(entry);
      if (norm) events.push(norm);
    }
    return events;
  }

  async resolveActors(
    _repo: RepoInfo,
    _mode: 'maintainers'
  ): Promise<string[]> {
    const result = await launch('glab', ['api', 'projects/:id/members/all'], {
      cwd: this.cwd,
    });

    if (result.failed || !result.stdout) return [];

    const members = JSON.parse(result.stdout.toString()) as Array<{
      username: string;
      access_level: number;
    }>;

    // 30 = Developer access and above
    return members.filter(m => m.access_level >= 30).map(m => m.username);
  }

  private async normalize(event: GLEvent): Promise<NormEvent | null> {
    const base = {
      id: event.id.toString(),
      source: 'gitlab' as const,
      actor: event.author.username,
      createdAt: event.created_at,
    };

    const action = event.action_name;
    const target = event.target_type;

    // Issue events
    if (target === 'Issue' || target === 'WorkItem') {
      const kind = mapGitLabIssueAction(action);
      if (!kind) return null;
      const iid = event.target_iid ?? event.target_id ?? 0;
      const detail = await this.fetchIssue(iid);
      return {
        ...base,
        kind,
        summary: `issue ${action} #${iid}`,
        meta: {
          action,
          targetType: target,
          issueIid: iid,
          title: detail?.title ?? event.target_title,
          body: ((detail?.description as string) ?? '').slice(0, 500),
          state: detail?.state,
          author: (detail?.author as Record<string, unknown>)?.username,
          labels: (detail?.labels as string[]) ?? [],
          assignees: (
            (detail?.assignees as Array<{ username: string }>) ?? []
          ).map(a => a.username),
          url: detail?.web_url,
        },
      };
    }

    // Merge request events
    if (target === 'MergeRequest') {
      const kind = mapGitLabMRAction(action);
      if (!kind) return null;
      const iid = event.target_iid ?? event.target_id ?? 0;
      const label = kind === 'pr.merged' ? 'merged' : action;
      const detail = await this.fetchMergeRequest(iid);
      return {
        ...base,
        kind,
        summary: `MR ${label} !${iid}`,
        meta: {
          action,
          targetType: target,
          mrIid: iid,
          title: detail?.title ?? event.target_title,
          body: ((detail?.description as string) ?? '').slice(0, 500),
          state: detail?.state,
          draft: detail?.draft ?? false,
          merged: detail?.state === 'merged',
          author: (detail?.author as Record<string, unknown>)?.username,
          branch: detail?.source_branch,
          baseBranch: detail?.target_branch,
          labels: (detail?.labels as string[]) ?? [],
          assignees: (
            (detail?.assignees as Array<{ username: string }>) ?? []
          ).map(a => a.username),
          reviewers: (
            (detail?.reviewers as Array<{ username: string }>) ?? []
          ).map(r => r.username),
          url: detail?.web_url,
        },
      };
    }

    // Comment events (Note / DiscussionNote / DiffNote)
    if (
      target === 'Note' ||
      target === 'DiscussionNote' ||
      target === 'DiffNote'
    ) {
      if (!action.startsWith('commented on')) return null;

      // Skip system-generated notes (label changes, etc.)
      if (event.note?.system) return null;

      // Skip self-generated Rover comments
      if ((event.note?.body ?? '').includes(ROVER_FOOTER_MARKER)) return null;

      const kind: EventKind =
        target === 'DiffNote' ? 'review_comment.created' : 'comment.created';

      return {
        ...base,
        kind,
        summary: `new comment on #${event.target_iid ?? event.target_id}`,
        meta: {
          action,
          targetType: target,
          noteId: event.target_id,
          body: (event.note?.body ?? '').slice(0, 200),
        },
      };
    }

    // Push events
    if (action === 'pushed to' || action === 'pushed new') {
      const pd = event.push_data;
      return {
        ...base,
        kind: 'push',
        summary: `new push to ${pd?.ref ?? 'unknown'}`,
        meta: {
          action,
          ref: pd?.ref,
          refType: pd?.ref_type,
          commitCount: pd?.commit_count ?? 0,
          headSha: pd?.commit_to,
          commits: pd?.commit_title
            ? [{ sha: pd.commit_to, message: pd.commit_title }]
            : [],
        },
      };
    }

    return null;
  }

  /** Fetch full issue details by IID. */
  private async fetchIssue(
    iid: number
  ): Promise<Record<string, unknown> | null> {
    try {
      const result = await launch(
        'glab',
        ['api', `projects/:id/issues/${iid}`],
        { cwd: this.cwd }
      );
      if (result.failed || !result.stdout) return null;
      return JSON.parse(result.stdout.toString());
    } catch {
      return null;
    }
  }

  /** Fetch full merge request details by IID. */
  private async fetchMergeRequest(
    iid: number
  ): Promise<Record<string, unknown> | null> {
    try {
      const result = await launch(
        'glab',
        ['api', `projects/:id/merge_requests/${iid}`],
        { cwd: this.cwd }
      );
      if (result.failed || !result.stdout) return null;
      return JSON.parse(result.stdout.toString());
    } catch {
      return null;
    }
  }
}

function mapGitLabIssueAction(action: string): EventKind | null {
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

function mapGitLabMRAction(action: string): EventKind | null {
  switch (action) {
    case 'opened':
      return 'pr.opened';
    case 'accepted':
      return 'pr.merged';
    case 'approved':
      return 'pr.approved';
    case 'closed':
      return 'pr.closed';
    default:
      return null;
  }
}
