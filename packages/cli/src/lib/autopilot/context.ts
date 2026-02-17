import { launch } from 'rover-core';

interface ContextResult {
  type: string;
  data: Record<string, any>;
}

async function ghJson(
  owner: string,
  repo: string,
  args: string[]
): Promise<Record<string, any> | null> {
  const result = await launch('gh', args, {
    env: { GH_REPO: `${owner}/${repo}` },
  });
  if (result.failed || !result.stdout) return null;
  try {
    return JSON.parse(result.stdout.toString());
  } catch {
    return null;
  }
}

export async function fetchContextForAction(
  owner: string,
  repo: string,
  meta: Record<string, any>
): Promise<ContextResult | null> {
  const type = meta.type as string | undefined;
  if (!type) return null;

  switch (type) {
    case 'IssuesEvent': {
      const num = meta.issueNumber;
      if (!num) return null;
      const data = await ghJson(owner, repo, [
        'issue',
        'view',
        String(num),
        '--json',
        'title,body,labels,state,assignees,milestone,comments,author,closedAt,createdAt',
      ]);
      if (!data) return null;
      // Summarize to reduce token usage: only keep comment count
      if (Array.isArray(data.comments)) {
        data.commentCount = data.comments.length;
        delete data.comments;
      }
      return { type, data };
    }

    case 'PullRequestEvent': {
      const num = meta.prNumber;
      if (!num) return null;
      const data = await ghJson(owner, repo, [
        'pr',
        'view',
        String(num),
        '--json',
        'title,body,state,headRefName,baseRefName,isDraft,labels,mergedAt,mergedBy,mergeStateStatus,mergeable,reviewDecision,reviewRequests,assignees,additions,deletions,changedFiles,statusCheckRollup,closedAt,createdAt,number',
      ]);
      if (!data) return null;
      // Summarize statusCheckRollup to reduce token usage
      if (Array.isArray(data.statusCheckRollup)) {
        data.statusChecks = data.statusCheckRollup.map(
          (c: Record<string, any>) => ({
            name: c.name,
            status: c.status,
            conclusion: c.conclusion,
            context: c.context,
          })
        );
        delete data.statusCheckRollup;
      }
      return { type, data };
    }

    case 'IssueCommentEvent': {
      const num = meta.issueNumber;
      if (!num) return null;
      // IssueCommentEvent fires for both issues and PRs; fetch accordingly
      const isPR = meta.isPullRequest === true;
      if (isPR) {
        const data = await ghJson(owner, repo, [
          'pr',
          'view',
          String(num),
          '--json',
          'title,body,state,mergedAt,reviewDecision,comments,closedAt',
        ]);
        if (!data) return null;
        // Keep only recent comments to reduce token usage
        if (Array.isArray(data.comments)) {
          data.commentCount = data.comments.length;
          data.recentComments = data.comments.slice(-5);
          delete data.comments;
        }
        return { type, data };
      }
      const data = await ghJson(owner, repo, [
        'issue',
        'view',
        String(num),
        '--json',
        'title,body,state,labels,comments,closedAt',
      ]);
      if (!data) return null;
      // Keep only recent comments to reduce token usage
      if (Array.isArray(data.comments)) {
        data.commentCount = data.comments.length;
        data.recentComments = data.comments.slice(-5);
        delete data.comments;
      }
      return { type, data };
    }

    case 'PullRequestReviewEvent':
    case 'PullRequestReviewCommentEvent': {
      const num = meta.prNumber;
      if (!num) return null;
      const data = await ghJson(owner, repo, [
        'pr',
        'view',
        String(num),
        '--json',
        'title,body,state,mergedAt,mergedBy,reviewDecision,reviewRequests,reviews,statusCheckRollup,mergeable,closedAt',
      ]);
      if (!data) return null;
      // Summarize statusCheckRollup
      if (Array.isArray(data.statusCheckRollup)) {
        data.statusChecks = data.statusCheckRollup.map(
          (c: Record<string, any>) => ({
            name: c.name,
            status: c.status,
            conclusion: c.conclusion,
            context: c.context,
          })
        );
        delete data.statusCheckRollup;
      }
      return { type, data };
    }

    case 'PushEvent':
      // Already self-contained
      return null;

    default:
      return null;
  }
}
