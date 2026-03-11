import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('rover-core', async () => {
  const actual =
    await vi.importActual<typeof import('rover-core')>('rover-core');
  return { ...actual, launch: vi.fn(), getProjectPath: () => '/tmp/test' };
});

import { launch } from 'rover-core';
import { GitHubFetcher } from '../github.js';
import { ROVER_FOOTER_MARKER } from '../../helpers.js';
import type { RepoInfo } from '../types.js';

const mockLaunch = launch as unknown as ReturnType<typeof vi.fn>;
type MockResult = { failed: boolean; stdout: string };

const repo: RepoInfo = {
  source: 'github',
  fullPath: 'owner/repo',
  owner: 'owner',
  repo: 'repo',
};

function ghEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    type: 'IssuesEvent',
    actor: { login: 'alice' },
    created_at: '2024-01-01T00:00:00Z',
    payload: {
      action: 'opened',
      issue: {
        number: 42,
        title: 'Bug report',
        state: 'open',
        user: { login: 'alice' },
        labels: [],
        assignees: [],
        html_url: 'https://github.com/owner/repo/issues/42',
      },
    },
    ...overrides,
  };
}

function mockStdout(...events: Record<string, unknown>[]) {
  const stdout = events.map(e => JSON.stringify(e)).join('\n');
  mockLaunch.mockResolvedValue({ failed: false, stdout } as MockResult);
}

describe('GitHubFetcher', () => {
  let fetcher: GitHubFetcher;

  beforeEach(() => {
    fetcher = new GitHubFetcher();
    mockLaunch.mockReset();
  });

  describe('fetchEvents() — API interaction', () => {
    it('calls gh api with correct URL and jq filter', async () => {
      mockStdout(ghEvent());
      await fetcher.fetchEvents(repo);

      expect(mockLaunch).toHaveBeenCalledWith('gh', [
        'api',
        'repos/owner/repo/events?per_page=25',
        '--jq',
        '.[] | {id, type, actor: {login: .actor.login}, created_at, payload}',
      ]);
    });

    it('throws on failed API call', async () => {
      mockLaunch.mockResolvedValue({
        failed: true,
        stdout: '',
      } as MockResult);

      await expect(fetcher.fetchEvents(repo)).rejects.toThrow(
        'gh api call failed'
      );
    });

    it('throws on empty stdout', async () => {
      mockLaunch.mockResolvedValue({
        failed: false,
        stdout: '',
      } as MockResult);

      await expect(fetcher.fetchEvents(repo)).rejects.toThrow(
        'gh api call failed'
      );
    });

    it('returns empty array when stdout contains only whitespace', async () => {
      mockLaunch.mockResolvedValue({
        failed: false,
        stdout: '  \n\n  \n',
      } as MockResult);

      // stdout is truthy (non-empty string), so no throw.
      // trim() → "", split → [""], filter(l => l.length > 0) → [], loop runs 0 times.
      const events = await fetcher.fetchEvents(repo);
      expect(events).toEqual([]);
    });

    it('handles a single valid event', async () => {
      mockStdout(ghEvent());
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
    });
  });

  // ── IssuesEvent normalization ────────────────────────────────────────

  describe('IssuesEvent normalization', () => {
    it('maps opened to issue.opened', async () => {
      mockStdout(
        ghEvent({
          payload: {
            action: 'opened',
            issue: {
              number: 42,
              title: 'Bug report',
              state: 'open',
              user: { login: 'alice' },
              labels: [{ name: 'bug' }],
              assignees: [{ login: 'bob' }],
              html_url: 'https://github.com/owner/repo/issues/42',
            },
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('issue.opened');
      expect(events[0].summary).toBe('issue opened #42');
      expect(events[0].source).toBe('github');
      expect(events[0].actor).toBe('alice');
      expect(events[0].createdAt).toBe('2024-01-01T00:00:00Z');
    });

    it('maps closed to issue.closed', async () => {
      mockStdout(
        ghEvent({
          payload: {
            action: 'closed',
            issue: {
              number: 10,
              title: 'Done',
              state: 'closed',
              user: { login: 'alice' },
              labels: [],
              assignees: [],
              html_url: '',
            },
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('issue.closed');
      expect(events[0].summary).toBe('issue closed #10');
    });

    it('maps reopened to issue.reopened', async () => {
      mockStdout(
        ghEvent({
          payload: {
            action: 'reopened',
            issue: {
              number: 5,
              title: 'Reopen',
              state: 'open',
              user: { login: 'alice' },
              labels: [],
              assignees: [],
              html_url: '',
            },
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('issue.reopened');
    });

    it.each([
      'labeled',
      'assigned',
      'milestoned',
      'edited',
      'pinned',
    ])('drops irrelevant action "%s"', async action => {
      mockStdout(ghEvent({ payload: { action } }));
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(0);
    });

    it('populates all meta fields correctly', async () => {
      mockStdout(
        ghEvent({
          id: '99',
          payload: {
            action: 'opened',
            issue: {
              number: 42,
              title: 'Feature request',
              state: 'open',
              user: { login: 'alice' },
              labels: [{ name: 'enhancement' }, { name: 'priority' }],
              assignees: [{ login: 'bob' }, { login: 'carol' }],
              html_url: 'https://github.com/owner/repo/issues/42',
            },
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      const meta = events[0].meta;
      expect(meta.type).toBe('IssuesEvent');
      expect(meta.action).toBe('opened');
      expect(meta.issueNumber).toBe(42);
      expect(meta.title).toBe('Feature request');
      expect(meta.state).toBe('open');
      expect(meta.author).toBe('alice');
      expect(meta.labels).toEqual(['enhancement', 'priority']);
      expect(meta.assignees).toEqual(['bob', 'carol']);
      expect(meta.url).toBe('https://github.com/owner/repo/issues/42');
    });

    it('handles missing optional fields gracefully', async () => {
      mockStdout(
        ghEvent({
          payload: {
            action: 'opened',
            issue: {
              number: 1,
              title: undefined,
              state: undefined,
              user: undefined,
            },
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].meta.labels).toEqual([]);
      expect(events[0].meta.assignees).toEqual([]);
      expect(events[0].meta.author).toBeUndefined();
    });
  });

  // ── PullRequestEvent normalization ─────────────────────────────────

  describe('PullRequestEvent normalization', () => {
    function prEvent(
      action: string,
      prOverrides: Record<string, unknown> = {}
    ) {
      return ghEvent({
        type: 'PullRequestEvent',
        payload: {
          action,
          pull_request: {
            number: 10,
            title: 'Fix bug',
            state: action === 'closed' ? 'closed' : 'open',
            merged: false,
            draft: false,
            user: { login: 'bob' },
            labels: [],
            assignees: [],
            requested_reviewers: [],
            head: { ref: 'fix-bug' },
            base: { ref: 'main' },
            additions: 5,
            deletions: 3,
            changed_files: 2,
            html_url: 'https://github.com/owner/repo/pull/10',
            ...prOverrides,
          },
        },
      });
    }

    it('maps opened to pr.opened', async () => {
      mockStdout(prEvent('opened'));
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('pr.opened');
      expect(events[0].summary).toBe('PR opened #10');
    });

    it('maps closed (not merged) to pr.closed', async () => {
      mockStdout(prEvent('closed', { merged: false }));
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('pr.closed');
      expect(events[0].summary).toBe('PR closed #10');
    });

    it('maps closed + merged:true to pr.merged with summary "merged"', async () => {
      mockStdout(prEvent('closed', { merged: true }));
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('pr.merged');
      expect(events[0].summary).toBe('PR merged #10');
    });

    it('maps reopened to pr.reopened', async () => {
      mockStdout(prEvent('reopened'));
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('pr.reopened');
    });

    it('maps ready_for_review to pr.ready_for_review', async () => {
      mockStdout(prEvent('ready_for_review'));
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('pr.ready_for_review');
    });

    it('maps review_requested to pr.review_requested', async () => {
      mockStdout(prEvent('review_requested'));
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('pr.review_requested');
    });

    it.each([
      'synchronize',
      'edited',
      'labeled',
      'auto_merge_enabled',
    ])('drops irrelevant PR action "%s"', async action => {
      mockStdout(prEvent(action));
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(0);
    });

    it('populates all PR meta fields correctly', async () => {
      mockStdout(
        prEvent('opened', {
          number: 20,
          title: 'Add feature',
          state: 'open',
          draft: true,
          merged: false,
          user: { login: 'bob' },
          labels: [{ name: 'feature' }],
          assignees: [{ login: 'carol' }],
          requested_reviewers: [{ login: 'dave' }, { login: 'eve' }],
          head: { ref: 'feature-branch' },
          base: { ref: 'develop' },
          additions: 100,
          deletions: 50,
          changed_files: 10,
          html_url: 'https://github.com/owner/repo/pull/20',
        })
      );

      const events = await fetcher.fetchEvents(repo);
      const meta = events[0].meta;
      expect(meta.type).toBe('PullRequestEvent');
      expect(meta.action).toBe('opened');
      expect(meta.prNumber).toBe(20);
      expect(meta.title).toBe('Add feature');
      expect(meta.state).toBe('open');
      expect(meta.draft).toBe(true);
      expect(meta.merged).toBe(false);
      expect(meta.author).toBe('bob');
      expect(meta.branch).toBe('feature-branch');
      expect(meta.baseBranch).toBe('develop');
      expect(meta.labels).toEqual(['feature']);
      expect(meta.assignees).toEqual(['carol']);
      expect(meta.requestedReviewers).toEqual(['dave', 'eve']);
      expect(meta.additions).toBe(100);
      expect(meta.deletions).toBe(50);
      expect(meta.changedFiles).toBe(10);
      expect(meta.url).toBe('https://github.com/owner/repo/pull/20');
    });

    it('defaults draft to false when missing', async () => {
      mockStdout(
        ghEvent({
          type: 'PullRequestEvent',
          payload: {
            action: 'opened',
            pull_request: {
              number: 1,
              title: 'PR',
              state: 'open',
              user: { login: 'x' },
              labels: [],
              assignees: [],
              requested_reviewers: [],
              head: { ref: 'a' },
              base: { ref: 'b' },
              html_url: '',
            },
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events[0].meta.draft).toBe(false);
    });

    it('defaults merged to false when missing', async () => {
      mockStdout(
        ghEvent({
          type: 'PullRequestEvent',
          payload: {
            action: 'opened',
            pull_request: {
              number: 1,
              title: 'PR',
              state: 'open',
              user: { login: 'x' },
              labels: [],
              assignees: [],
              requested_reviewers: [],
              head: { ref: 'a' },
              base: { ref: 'b' },
              html_url: '',
            },
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events[0].meta.merged).toBe(false);
    });
  });

  // ── IssueCommentEvent normalization ────────────────────────────────

  describe('IssueCommentEvent normalization', () => {
    function commentEvent(overrides: Record<string, unknown> = {}) {
      return ghEvent({
        type: 'IssueCommentEvent',
        payload: {
          action: 'created',
          issue: { number: 5, title: 'Issue', state: 'open' },
          comment: {
            id: 100,
            user: { login: 'commenter' },
            body: 'Looks good to me.',
          },
          ...overrides,
        },
      });
    }

    it('maps created action to comment.created', async () => {
      mockStdout(commentEvent());
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('comment.created');
      expect(events[0].summary).toBe('new comment on #5');
    });

    it.each([
      'edited',
      'deleted',
    ])('drops non-created action "%s"', async action => {
      mockStdout(commentEvent({ action }));
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(0);
    });

    it('drops comment containing ROVER_FOOTER_MARKER', async () => {
      mockStdout(
        commentEvent({
          comment: {
            id: 200,
            user: { login: 'bot' },
            body: `Some text\n<details>\n${ROVER_FOOTER_MARKER}\n</details>`,
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(0);
    });

    it('keeps comment without ROVER_FOOTER_MARKER', async () => {
      mockStdout(
        commentEvent({
          comment: {
            id: 201,
            user: { login: 'human' },
            body: 'Regular comment without the marker.',
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('comment.created');
    });

    it('sets isPullRequest flag when issue has pull_request field', async () => {
      mockStdout(
        commentEvent({
          issue: {
            number: 5,
            title: 'PR-linked issue',
            state: 'open',
            pull_request: {
              url: 'https://api.github.com/repos/owner/repo/pulls/5',
            },
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events[0].meta.isPullRequest).toBe(true);
    });

    it('sets isPullRequest to false when issue has no pull_request field', async () => {
      mockStdout(commentEvent());
      const events = await fetcher.fetchEvents(repo);
      expect(events[0].meta.isPullRequest).toBe(false);
    });

    it('truncates body to 200 characters', async () => {
      const longBody = 'x'.repeat(300);
      mockStdout(
        commentEvent({
          comment: {
            id: 300,
            user: { login: 'verbose' },
            body: longBody,
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events[0].meta.body).toHaveLength(200);
      expect(events[0].meta.body).toBe(longBody.slice(0, 200));
    });

    it('handles null comment body gracefully', async () => {
      mockStdout(
        commentEvent({
          comment: {
            id: 400,
            user: { login: 'user' },
            body: null,
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].meta.body).toBe('');
    });

    it('handles empty comment body gracefully', async () => {
      mockStdout(
        commentEvent({
          comment: {
            id: 401,
            user: { login: 'user' },
            body: '',
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].meta.body).toBe('');
    });

    it('includes correct meta fields', async () => {
      mockStdout(commentEvent());
      const events = await fetcher.fetchEvents(repo);
      const meta = events[0].meta;
      expect(meta.type).toBe('IssueCommentEvent');
      expect(meta.issueNumber).toBe(5);
      expect(meta.issueTitle).toBe('Issue');
      expect(meta.issueState).toBe('open');
      expect(meta.author).toBe('commenter');
      expect(meta.commentId).toBe(100);
    });
  });

  // ── PullRequestReviewEvent normalization ───────────────────────────

  describe('PullRequestReviewEvent normalization', () => {
    function reviewEvent(overrides: Record<string, unknown> = {}) {
      return ghEvent({
        type: 'PullRequestReviewEvent',
        payload: {
          action: 'submitted',
          pull_request: {
            number: 15,
            title: 'Add tests',
            state: 'open',
            merged: false,
          },
          review: {
            user: { login: 'reviewer' },
            state: 'APPROVED',
            body: 'Looks great!',
          },
          ...overrides,
        },
      });
    }

    it('maps submitted to pr.review_submitted', async () => {
      mockStdout(reviewEvent());
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('pr.review_submitted');
      expect(events[0].summary).toBe('new review on PR #15');
    });

    it.each([
      'created',
      'edited',
      'dismissed',
    ])('drops non-submitted action "%s"', async action => {
      mockStdout(reviewEvent({ action }));
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(0);
    });

    it('drops review containing ROVER_FOOTER_MARKER', async () => {
      mockStdout(
        reviewEvent({
          review: {
            user: { login: 'bot' },
            state: 'COMMENTED',
            body: `Automated review\n${ROVER_FOOTER_MARKER}\nend`,
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(0);
    });

    it('keeps review without ROVER_FOOTER_MARKER', async () => {
      mockStdout(reviewEvent());
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
    });

    it('handles null review body (treated as empty string, not dropped)', async () => {
      mockStdout(
        reviewEvent({
          review: {
            user: { login: 'reviewer' },
            state: 'APPROVED',
            body: null,
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].meta.body).toBe('');
    });

    it('handles empty review body (not dropped)', async () => {
      mockStdout(
        reviewEvent({
          review: {
            user: { login: 'reviewer' },
            state: 'APPROVED',
            body: '',
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].meta.body).toBe('');
    });

    it('populates review meta fields correctly', async () => {
      mockStdout(reviewEvent());
      const events = await fetcher.fetchEvents(repo);
      const meta = events[0].meta;
      expect(meta.type).toBe('PullRequestReviewEvent');
      expect(meta.prNumber).toBe(15);
      expect(meta.prTitle).toBe('Add tests');
      expect(meta.prState).toBe('open');
      expect(meta.prMerged).toBe(false);
      expect(meta.reviewer).toBe('reviewer');
      expect(meta.state).toBe('APPROVED');
      expect(meta.body).toBe('Looks great!');
    });
  });

  // ── PullRequestReviewCommentEvent normalization ────────────────────

  describe('PullRequestReviewCommentEvent normalization', () => {
    function reviewCommentEvent(overrides: Record<string, unknown> = {}) {
      return ghEvent({
        type: 'PullRequestReviewCommentEvent',
        payload: {
          action: 'created',
          pull_request: {
            number: 20,
            title: 'Refactor',
            state: 'open',
            merged: false,
          },
          comment: {
            id: 500,
            user: { login: 'reviewer' },
            path: 'src/main.ts',
            body: 'Consider renaming this.',
          },
          ...overrides,
        },
      });
    }

    it('maps created to review_comment.created', async () => {
      mockStdout(reviewCommentEvent());
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('review_comment.created');
      expect(events[0].summary).toBe('new review comment on PR #20');
    });

    it.each([
      'edited',
      'deleted',
    ])('drops non-created action "%s"', async action => {
      mockStdout(reviewCommentEvent({ action }));
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(0);
    });

    it('drops comment containing ROVER_FOOTER_MARKER', async () => {
      mockStdout(
        reviewCommentEvent({
          comment: {
            id: 501,
            user: { login: 'bot' },
            path: 'src/x.ts',
            body: `Auto comment ${ROVER_FOOTER_MARKER}`,
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(0);
    });

    it('keeps comment without ROVER_FOOTER_MARKER', async () => {
      mockStdout(reviewCommentEvent());
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
    });

    it('includes path field in meta', async () => {
      mockStdout(reviewCommentEvent());
      const events = await fetcher.fetchEvents(repo);
      expect(events[0].meta.path).toBe('src/main.ts');
    });

    it('truncates body to 200 characters', async () => {
      const longBody = 'a'.repeat(250);
      mockStdout(
        reviewCommentEvent({
          comment: {
            id: 502,
            user: { login: 'reviewer' },
            path: 'src/x.ts',
            body: longBody,
          },
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events[0].meta.body).toHaveLength(200);
    });

    it('populates all review comment meta fields', async () => {
      mockStdout(reviewCommentEvent());
      const events = await fetcher.fetchEvents(repo);
      const meta = events[0].meta;
      expect(meta.type).toBe('PullRequestReviewCommentEvent');
      expect(meta.prNumber).toBe(20);
      expect(meta.prTitle).toBe('Refactor');
      expect(meta.prState).toBe('open');
      expect(meta.prMerged).toBe(false);
      expect(meta.author).toBe('reviewer');
      expect(meta.commentId).toBe(500);
      expect(meta.path).toBe('src/main.ts');
    });
  });

  // ── PushEvent normalization ────────────────────────────────────────

  describe('PushEvent normalization', () => {
    function pushEvent(overrides: Record<string, unknown> = {}) {
      return ghEvent({
        type: 'PushEvent',
        payload: {
          ref: 'refs/heads/main',
          size: 2,
          head: 'abc123',
          commits: [
            { sha: 'abc123', message: 'feat: add feature' },
            { sha: 'def456', message: 'fix: fix bug' },
          ],
          ...overrides,
        },
      });
    }

    it('always produces a push event (no action filter)', async () => {
      mockStdout(pushEvent());
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('push');
      expect(events[0].summary).toBe('new push to refs/heads/main');
    });

    it('maps commit list correctly', async () => {
      mockStdout(pushEvent());
      const events = await fetcher.fetchEvents(repo);
      expect(events[0].meta.commits).toEqual([
        { sha: 'abc123', message: 'feat: add feature' },
        { sha: 'def456', message: 'fix: fix bug' },
      ]);
    });

    it('uses size field for commitCount', async () => {
      mockStdout(pushEvent({ size: 5 }));
      const events = await fetcher.fetchEvents(repo);
      expect(events[0].meta.commitCount).toBe(5);
    });

    it('falls back to commits.length when size is missing', async () => {
      mockStdout(
        pushEvent({
          size: undefined,
          commits: [
            { sha: 'a', message: 'one' },
            { sha: 'b', message: 'two' },
            { sha: 'c', message: 'three' },
          ],
        })
      );

      const events = await fetcher.fetchEvents(repo);
      expect(events[0].meta.commitCount).toBe(3);
    });

    it('handles empty commits array', async () => {
      mockStdout(pushEvent({ size: 0, commits: [] }));
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].meta.commitCount).toBe(0);
      expect(events[0].meta.commits).toEqual([]);
    });

    it('handles missing commits array', async () => {
      mockStdout(pushEvent({ size: undefined, commits: undefined }));
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].meta.commitCount).toBe(0);
      expect(events[0].meta.commits).toEqual([]);
    });

    it('populates push meta fields', async () => {
      mockStdout(pushEvent());
      const events = await fetcher.fetchEvents(repo);
      const meta = events[0].meta;
      expect(meta.type).toBe('PushEvent');
      expect(meta.ref).toBe('refs/heads/main');
      expect(meta.pusher).toBe('alice');
      expect(meta.headSha).toBe('abc123');
    });
  });

  // ── Unknown event types ────────────────────────────────────────────

  describe('unknown event types', () => {
    it('drops unknown event types', async () => {
      mockStdout(ghEvent({ type: 'WatchEvent' }));
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(0);
    });

    it('drops ForkEvent', async () => {
      mockStdout(ghEvent({ type: 'ForkEvent' }));
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(0);
    });

    it('drops CreateEvent', async () => {
      mockStdout(ghEvent({ type: 'CreateEvent' }));
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(0);
    });
  });

  // ── Bot name filtering ────────────────────────────────────────────

  describe('bot name filtering', () => {
    it('skips bot events before normalization', async () => {
      const botFetcher = new GitHubFetcher({ botName: 'my-bot' });
      mockStdout(ghEvent({ actor: { login: 'my-bot' } }));
      const events = await botFetcher.fetchEvents(repo);
      expect(events).toHaveLength(0);
    });

    it('filters case-insensitively', async () => {
      const botFetcher = new GitHubFetcher({ botName: 'MY-BOT' });
      mockStdout(ghEvent({ actor: { login: 'my-bot' } }));
      const events = await botFetcher.fetchEvents(repo);
      expect(events).toHaveLength(0);
    });

    it('filters when actor has different case than botName', async () => {
      const botFetcher = new GitHubFetcher({ botName: 'rover-bot' });
      mockStdout(ghEvent({ actor: { login: 'Rover-Bot' } }));
      const events = await botFetcher.fetchEvents(repo);
      expect(events).toHaveLength(0);
    });

    it('passes through all events when no botName is set', async () => {
      const noBotFetcher = new GitHubFetcher();
      mockStdout(ghEvent({ actor: { login: 'rover-bot' } }));
      const events = await noBotFetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
    });

    it('keeps human events while filtering bot events in mixed response', async () => {
      const botFetcher = new GitHubFetcher({ botName: 'bot' });
      const botIssue = ghEvent({
        id: '1',
        actor: { login: 'bot' },
        payload: {
          action: 'opened',
          issue: {
            number: 1,
            title: 'Bot issue',
            state: 'open',
            user: { login: 'bot' },
            labels: [],
            assignees: [],
            html_url: '',
          },
        },
      });
      const humanIssue = ghEvent({
        id: '2',
        actor: { login: 'alice' },
        payload: {
          action: 'opened',
          issue: {
            number: 2,
            title: 'Human issue',
            state: 'open',
            user: { login: 'alice' },
            labels: [],
            assignees: [],
            html_url: '',
          },
        },
      });
      const botPush = ghEvent({
        id: '3',
        type: 'PushEvent',
        actor: { login: 'Bot' },
        payload: {
          ref: 'refs/heads/main',
          size: 1,
          head: 'aaa',
          commits: [{ sha: 'aaa', message: 'bot commit' }],
        },
      });

      mockStdout(botIssue, humanIssue, botPush);
      const events = await botFetcher.fetchEvents(repo);
      expect(events).toHaveLength(1);
      expect(events[0].actor).toBe('alice');
      expect(events[0].id).toBe('2');
    });
  });

  // ── resolveActors ─────────────────────────────────────────────────

  describe('resolveActors()', () => {
    it('returns parsed actor logins', async () => {
      mockLaunch.mockResolvedValue({
        failed: false,
        stdout: 'alice\nbob\ncharlie\n',
      } as MockResult);

      const actors = await fetcher.resolveActors(repo, 'maintainers');
      expect(actors).toEqual(['alice', 'bob', 'charlie']);
    });

    it('calls gh api with correct collaborators URL', async () => {
      mockLaunch.mockResolvedValue({
        failed: false,
        stdout: 'alice\n',
      } as MockResult);

      await fetcher.resolveActors(repo, 'maintainers');
      expect(mockLaunch).toHaveBeenCalledWith('gh', [
        'api',
        'repos/owner/repo/collaborators',
        '--jq',
        '.[].login',
      ]);
    });

    it('returns empty array on failed API call', async () => {
      mockLaunch.mockResolvedValue({
        failed: true,
        stdout: '',
      } as MockResult);

      const actors = await fetcher.resolveActors(repo, 'maintainers');
      expect(actors).toEqual([]);
    });

    it('returns empty array on empty stdout', async () => {
      mockLaunch.mockResolvedValue({
        failed: false,
        stdout: '',
      } as MockResult);

      const actors = await fetcher.resolveActors(repo, 'maintainers');
      expect(actors).toEqual([]);
    });

    it('filters out empty lines from output', async () => {
      mockLaunch.mockResolvedValue({
        failed: false,
        stdout: 'alice\n\nbob\n\n',
      } as MockResult);

      const actors = await fetcher.resolveActors(repo, 'maintainers');
      expect(actors).toEqual(['alice', 'bob']);
    });
  });

  // ── Multiple events in single response ────────────────────────────

  describe('multiple events in single response', () => {
    it('handles mix of valid and invalid events', async () => {
      const issueOpened = ghEvent({
        id: '1',
        payload: {
          action: 'opened',
          issue: {
            number: 1,
            title: 'Issue',
            state: 'open',
            user: { login: 'alice' },
            labels: [],
            assignees: [],
            html_url: '',
          },
        },
      });
      const issueLabeled = ghEvent({
        id: '2',
        payload: { action: 'labeled' },
      });
      const unknownType = ghEvent({ id: '3', type: 'WatchEvent' });
      const push = ghEvent({
        id: '4',
        type: 'PushEvent',
        payload: {
          ref: 'refs/heads/main',
          size: 1,
          head: 'abc',
          commits: [{ sha: 'abc', message: 'commit' }],
        },
      });

      mockStdout(issueOpened, issueLabeled, unknownType, push);
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(2);
      expect(events[0].kind).toBe('issue.opened');
      expect(events[1].kind).toBe('push');
    });

    it('returns correct count when all events are valid', async () => {
      const e1 = ghEvent({
        id: '1',
        payload: {
          action: 'opened',
          issue: {
            number: 1,
            title: 'A',
            state: 'open',
            user: { login: 'a' },
            labels: [],
            assignees: [],
            html_url: '',
          },
        },
      });
      const e2 = ghEvent({
        id: '2',
        payload: {
          action: 'closed',
          issue: {
            number: 2,
            title: 'B',
            state: 'closed',
            user: { login: 'b' },
            labels: [],
            assignees: [],
            html_url: '',
          },
        },
      });

      mockStdout(e1, e2);
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(2);
    });

    it('returns empty array when all events are irrelevant', async () => {
      const e1 = ghEvent({ id: '1', type: 'WatchEvent' });
      const e2 = ghEvent({ id: '2', type: 'ForkEvent' });
      const e3 = ghEvent({ id: '3', payload: { action: 'labeled' } });

      mockStdout(e1, e2, e3);
      const events = await fetcher.fetchEvents(repo);
      expect(events).toHaveLength(0);
    });
  });

  // ── source property ────────────────────────────────────────────────

  describe('source property', () => {
    it('has source set to github', () => {
      expect(fetcher.source).toBe('github');
    });
  });
});
