/** Identifies which platform the repo is hosted on. */
export type PlatformSource = 'github' | 'gitlab';

/** Repo coordinates parsed from a git remote URL. */
export interface RepoInfo {
  source: PlatformSource;
  /** "owner/repo" for GitHub, "group/subgroup/project" for GitLab */
  fullPath: string;
  /** First path segment (owner or group). */
  owner: string;
  /** Last path segment (repo or project name). */
  repo: string;
}

/** Normalized event type — what the pipeline cares about. */
export type EventKind =
  | 'issue.opened'
  | 'issue.closed'
  | 'issue.reopened'
  | 'pr.opened'
  | 'pr.closed'
  | 'pr.reopened'
  | 'pr.merged'
  | 'pr.review_requested'
  | 'pr.ready_for_review'
  | 'pr.review_submitted'
  | 'pr.approved'
  | 'comment.created'
  | 'review_comment.created'
  | 'push';

/** A normalized, source-agnostic event ready for the pipeline. */
export interface NormEvent {
  id: string;
  kind: EventKind;
  source: PlatformSource;
  actor: string;
  createdAt: string;
  summary: string;
  meta: Record<string, unknown>;
}

/** Interface that each platform fetcher implements. */
export interface EventFetcher {
  readonly source: PlatformSource;

  /** Fetch recent events from the platform API. */
  fetchEvents(repo: RepoInfo): Promise<NormEvent[]>;

  /** Resolve allowed actors for --allow-events filtering. */
  resolveActors(repo: RepoInfo, mode: 'maintainers'): Promise<string[]>;
}
