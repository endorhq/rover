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
        'title,body,labels,state',
      ]);
      return data ? { type, data } : null;
    }

    case 'PullRequestEvent': {
      const num = meta.prNumber;
      if (!num) return null;
      const data = await ghJson(owner, repo, [
        'pr',
        'view',
        String(num),
        '--json',
        'title,body,headRefName,isDraft,labels',
      ]);
      return data ? { type, data } : null;
    }

    case 'IssueCommentEvent': {
      const num = meta.issueNumber;
      if (!num) return null;
      const data = await ghJson(owner, repo, [
        'issue',
        'view',
        String(num),
        '--json',
        'title,body,comments',
      ]);
      return data ? { type, data } : null;
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
        'title,body,reviews',
      ]);
      return data ? { type, data } : null;
    }

    case 'PushEvent':
      // Already self-contained
      return null;

    default:
      return null;
  }
}
