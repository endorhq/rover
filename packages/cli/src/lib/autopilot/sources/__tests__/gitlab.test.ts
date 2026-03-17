import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('rover-core', async () => {
  const actual =
    await vi.importActual<typeof import('rover-core')>('rover-core');
  return { ...actual, launch: vi.fn(), getProjectPath: () => '/tmp/test' };
});

import { launch } from 'rover-core';
import { GitLabFetcher } from '../gitlab.js';
import { ROVER_FOOTER_MARKER } from '../../helpers.js';
import type { FetchStopCondition, RepoInfo } from '../types.js';

const mockLaunch = launch as unknown as ReturnType<typeof vi.fn>;
type MockResult = { failed: boolean; stdout: string };

const noStop: FetchStopCondition = { isProcessed: () => false };

const repo: RepoInfo = {
  source: 'gitlab',
  fullPath: 'group/project',
  owner: 'group',
  repo: 'project',
};

/** Helper to build a minimal GitLab event object. */
function glEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    action_name: 'opened',
    target_type: 'Issue',
    target_id: 1,
    target_iid: 42,
    target_title: 'Default title',
    author: { username: 'alice' },
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Helper to build a minimal issue detail response. */
function issueDetail(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Bug report',
    description: 'Some description',
    state: 'opened',
    author: { username: 'alice' },
    labels: ['bug'],
    assignees: [{ username: 'bob' }],
    web_url: 'https://gitlab.com/group/project/-/issues/42',
    ...overrides,
  };
}

/** Helper to build a minimal merge request detail response. */
function mrDetail(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Fix bug',
    description: 'MR description',
    state: 'opened',
    draft: false,
    author: { username: 'alice' },
    source_branch: 'fix-bug',
    target_branch: 'main',
    labels: ['bugfix'],
    assignees: [{ username: 'alice' }],
    reviewers: [{ username: 'reviewer1' }],
    web_url: 'https://gitlab.com/group/project/-/merge_requests/10',
    ...overrides,
  };
}

/** Mock the events list response (first call) and optionally a detail response (second call). */
function mockEventsList(events: Record<string, unknown>[]) {
  mockLaunch.mockResolvedValueOnce({
    failed: false,
    stdout: JSON.stringify(events),
  } as MockResult);
}

function mockDetailResponse(detail: Record<string, unknown>) {
  mockLaunch.mockResolvedValueOnce({
    failed: false,
    stdout: JSON.stringify(detail),
  } as MockResult);
}

function mockDetailFailure() {
  mockLaunch.mockResolvedValueOnce({
    failed: true,
    stdout: '',
  } as MockResult);
}

describe('GitLabFetcher', () => {
  let fetcher: GitLabFetcher;

  beforeEach(() => {
    mockLaunch.mockReset();
    // Default fallback: any unmocked call (e.g. page-2 pagination) returns empty.
    // Individual mockResolvedValueOnce calls take priority over this default.
    mockLaunch.mockResolvedValue({ failed: false, stdout: '[]' } as MockResult);
    fetcher = new GitLabFetcher('/tmp/test');
  });

  // ── fetchEvents — API interaction ───────────────────────────────────

  describe('fetchEvents — API interaction', () => {
    it('calls glab api with correct URL and cwd', async () => {
      mockEventsList([]);

      await fetcher.fetchEvents(repo, noStop);

      expect(mockLaunch).toHaveBeenCalledWith(
        'glab',
        ['api', 'projects/:id/events?per_page=100&page=1'],
        { cwd: '/tmp/test' }
      );
    });

    it('throws on failed API call', async () => {
      mockLaunch.mockResolvedValueOnce({
        failed: true,
        stdout: '',
      } as MockResult);

      await expect(fetcher.fetchEvents(repo, noStop)).rejects.toThrow(
        'glab api call failed'
      );
    });

    it('returns empty array on empty stdout', async () => {
      mockLaunch.mockReset();
      mockLaunch.mockResolvedValueOnce({
        failed: false,
        stdout: '',
      } as MockResult);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toEqual([]);
    });

    it('returns empty array for empty event list', async () => {
      mockEventsList([]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toEqual([]);
    });
  });

  // ── Issue events ────────────────────────────────────────────────────

  describe('Issue events (target_type: Issue)', () => {
    it('maps opened to issue.opened with enriched detail data', async () => {
      mockEventsList([glEvent()]);
      mockDetailResponse(issueDetail());

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        id: '1',
        kind: 'issue.opened',
        source: 'gitlab',
        actor: 'alice',
        createdAt: '2024-01-01T00:00:00Z',
        summary: 'issue opened #42',
      });
    });

    it('maps closed to issue.closed', async () => {
      mockEventsList([glEvent({ id: 2, action_name: 'closed' })]);
      mockDetailResponse(issueDetail({ state: 'closed' }));

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('issue.closed');
    });

    it('maps reopened to issue.reopened', async () => {
      mockEventsList([glEvent({ id: 3, action_name: 'reopened' })]);
      mockDetailResponse(issueDetail({ state: 'opened' }));

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('issue.reopened');
    });

    it('drops irrelevant actions like updated', async () => {
      mockEventsList([glEvent({ action_name: 'updated' })]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(0);
      // No detail fetch should be made for a dropped event (page 1 + page 2 empty)
      expect(mockLaunch).toHaveBeenCalledTimes(2);
    });

    it('enriches meta with title, body, state, author, labels, assignees, url', async () => {
      mockEventsList([glEvent()]);
      mockDetailResponse(
        issueDetail({
          title: 'Real title',
          description: 'Body content here',
          state: 'opened',
          author: { username: 'opener' },
          labels: ['bug', 'p1'],
          assignees: [{ username: 'dev1' }, { username: 'dev2' }],
          web_url: 'https://gitlab.com/group/project/-/issues/42',
        })
      );

      const events = await fetcher.fetchEvents(repo, noStop);
      const meta = events[0].meta;
      expect(meta.title).toBe('Real title');
      expect(meta.body).toBe('Body content here');
      expect(meta.state).toBe('opened');
      expect(meta.author).toBe('opener');
      expect(meta.labels).toEqual(['bug', 'p1']);
      expect(meta.assignees).toEqual(['dev1', 'dev2']);
      expect(meta.url).toBe('https://gitlab.com/group/project/-/issues/42');
      expect(meta.action).toBe('opened');
      expect(meta.targetType).toBe('Issue');
      expect(meta.issueIid).toBe(42);
    });

    it('slices body to 500 characters', async () => {
      const longBody = 'x'.repeat(700);
      mockEventsList([glEvent()]);
      mockDetailResponse(issueDetail({ description: longBody }));

      const events = await fetcher.fetchEvents(repo, noStop);
      expect((events[0].meta.body as string).length).toBe(500);
    });

    it('falls back to event-level target_title when detail fetch fails', async () => {
      mockEventsList([glEvent({ target_title: 'Fallback title from event' })]);
      mockDetailFailure();

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].meta.title).toBe('Fallback title from event');
      expect(events[0].meta.body).toBe('');
      expect(events[0].meta.labels).toEqual([]);
      expect(events[0].meta.assignees).toEqual([]);
    });

    it('uses target_iid over target_id when both are present', async () => {
      mockEventsList([glEvent({ target_id: 999, target_iid: 42 })]);
      mockDetailResponse(issueDetail());

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events[0].summary).toBe('issue opened #42');
      expect(events[0].meta.issueIid).toBe(42);
      // Verify detail API was called with the iid (page 1 + detail + page 2 empty)
      expect(mockLaunch).toHaveBeenCalledTimes(3);
      expect(mockLaunch).toHaveBeenNthCalledWith(
        2,
        'glab',
        ['api', 'projects/:id/issues/42'],
        { cwd: '/tmp/test' }
      );
    });

    it('falls back to target_id when target_iid is undefined', async () => {
      mockEventsList([glEvent({ target_id: 55, target_iid: undefined })]);
      mockDetailResponse(issueDetail());

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events[0].summary).toBe('issue opened #55');
      expect(events[0].meta.issueIid).toBe(55);
    });

    it('uses 0 when both target_iid and target_id are null', async () => {
      mockEventsList([glEvent({ target_id: null, target_iid: undefined })]);
      mockDetailResponse(issueDetail());

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events[0].summary).toBe('issue opened #0');
      expect(events[0].meta.issueIid).toBe(0);
    });
  });

  // ── WorkItem events ─────────────────────────────────────────────────

  describe('WorkItem events (target_type: WorkItem)', () => {
    it('treats WorkItem closed same as Issue closed', async () => {
      mockEventsList([
        glEvent({
          id: 10,
          action_name: 'closed',
          target_type: 'WorkItem',
          target_iid: 50,
        }),
      ]);
      mockDetailResponse(
        issueDetail({ state: 'closed', title: 'Work item task' })
      );

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('issue.closed');
      expect(events[0].meta.targetType).toBe('WorkItem');
    });

    it('maps WorkItem opened to issue.opened', async () => {
      mockEventsList([
        glEvent({
          id: 11,
          action_name: 'opened',
          target_type: 'WorkItem',
          target_iid: 51,
        }),
      ]);
      mockDetailResponse(issueDetail());

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('issue.opened');
    });

    it('triggers detail fetch for WorkItem events', async () => {
      mockEventsList([
        glEvent({
          action_name: 'reopened',
          target_type: 'WorkItem',
          target_iid: 52,
        }),
      ]);
      mockDetailResponse(issueDetail({ state: 'opened' }));

      await fetcher.fetchEvents(repo, noStop);
      expect(mockLaunch).toHaveBeenCalledTimes(3);
      expect(mockLaunch).toHaveBeenNthCalledWith(
        2,
        'glab',
        ['api', 'projects/:id/issues/52'],
        { cwd: '/tmp/test' }
      );
    });
  });

  // ── MergeRequest events ─────────────────────────────────────────────

  describe('MergeRequest events', () => {
    const mrEvent = (overrides: Record<string, unknown> = {}) =>
      glEvent({
        id: 20,
        action_name: 'opened',
        target_type: 'MergeRequest',
        target_id: 5,
        target_iid: 10,
        target_title: 'MR title',
        ...overrides,
      });

    it('maps opened to pr.opened with enriched data', async () => {
      mockEventsList([mrEvent()]);
      mockDetailResponse(mrDetail());

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        id: '20',
        kind: 'pr.opened',
        source: 'gitlab',
        summary: 'MR opened !10',
      });
    });

    it('maps accepted to pr.merged with summary saying "merged"', async () => {
      mockEventsList([mrEvent({ id: 21, action_name: 'accepted' })]);
      mockDetailResponse(mrDetail({ state: 'merged' }));

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('pr.merged');
      expect(events[0].summary).toBe('MR merged !10');
    });

    it('maps approved to pr.approved', async () => {
      mockEventsList([mrEvent({ id: 22, action_name: 'approved' })]);
      mockDetailResponse(mrDetail());

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('pr.approved');
      expect(events[0].summary).toBe('MR approved !10');
    });

    it('maps closed to pr.closed', async () => {
      mockEventsList([mrEvent({ id: 23, action_name: 'closed' })]);
      mockDetailResponse(mrDetail({ state: 'closed' }));

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('pr.closed');
      expect(events[0].summary).toBe('MR closed !10');
    });

    it('drops irrelevant actions like updated', async () => {
      mockEventsList([mrEvent({ action_name: 'updated' })]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(0);
      expect(mockLaunch).toHaveBeenCalledTimes(2);
    });

    it('enriches meta with all MR-specific fields', async () => {
      mockEventsList([mrEvent()]);
      mockDetailResponse(
        mrDetail({
          title: 'Enriched MR',
          description: 'Detailed description',
          state: 'opened',
          draft: true,
          author: { username: 'author1' },
          source_branch: 'feature-branch',
          target_branch: 'develop',
          labels: ['enhancement', 'v2'],
          assignees: [{ username: 'a1' }, { username: 'a2' }],
          reviewers: [{ username: 'r1' }, { username: 'r2' }],
          web_url: 'https://gitlab.com/group/project/-/merge_requests/10',
        })
      );

      const events = await fetcher.fetchEvents(repo, noStop);
      const meta = events[0].meta;
      expect(meta.title).toBe('Enriched MR');
      expect(meta.body).toBe('Detailed description');
      expect(meta.state).toBe('opened');
      expect(meta.draft).toBe(true);
      expect(meta.merged).toBe(false);
      expect(meta.author).toBe('author1');
      expect(meta.branch).toBe('feature-branch');
      expect(meta.baseBranch).toBe('develop');
      expect(meta.labels).toEqual(['enhancement', 'v2']);
      expect(meta.assignees).toEqual(['a1', 'a2']);
      expect(meta.reviewers).toEqual(['r1', 'r2']);
      expect(meta.url).toBe(
        'https://gitlab.com/group/project/-/merge_requests/10'
      );
      expect(meta.action).toBe('opened');
      expect(meta.targetType).toBe('MergeRequest');
      expect(meta.mrIid).toBe(10);
    });

    it('derives merged=true from state==="merged"', async () => {
      mockEventsList([mrEvent({ action_name: 'accepted' })]);
      mockDetailResponse(mrDetail({ state: 'merged' }));

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events[0].meta.merged).toBe(true);
    });

    it('derives merged=false from state!=="merged"', async () => {
      mockEventsList([mrEvent()]);
      mockDetailResponse(mrDetail({ state: 'opened' }));

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events[0].meta.merged).toBe(false);
    });

    it('slices body to 500 characters', async () => {
      const longDesc = 'y'.repeat(800);
      mockEventsList([mrEvent()]);
      mockDetailResponse(mrDetail({ description: longDesc }));

      const events = await fetcher.fetchEvents(repo, noStop);
      expect((events[0].meta.body as string).length).toBe(500);
    });

    it('falls back gracefully when detail fetch fails', async () => {
      mockEventsList([mrEvent({ target_title: 'Fallback MR' })]);
      mockDetailFailure();

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('pr.opened');
      expect(events[0].meta.title).toBe('Fallback MR');
      expect(events[0].meta.body).toBe('');
      expect(events[0].meta.draft).toBe(false);
      expect(events[0].meta.labels).toEqual([]);
      expect(events[0].meta.assignees).toEqual([]);
      expect(events[0].meta.reviewers).toEqual([]);
    });

    it('calls glab api with correct merge_requests URL', async () => {
      mockEventsList([mrEvent({ target_iid: 77 })]);
      mockDetailResponse(mrDetail());

      await fetcher.fetchEvents(repo, noStop);
      expect(mockLaunch).toHaveBeenNthCalledWith(
        2,
        'glab',
        ['api', 'projects/:id/merge_requests/77'],
        { cwd: '/tmp/test' }
      );
    });
  });

  // ── Note events (comment.created) ───────────────────────────────────

  describe('Note events (comment.created)', () => {
    const noteEvent = (overrides: Record<string, unknown> = {}) =>
      glEvent({
        id: 30,
        action_name: 'commented on',
        target_type: 'Note',
        target_id: 200,
        target_iid: 15,
        target_title: null,
        note: { body: 'Great work!', system: false },
        ...overrides,
      });

    it('maps Note with "commented on" to comment.created', async () => {
      mockEventsList([noteEvent()]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('comment.created');
      expect(events[0].summary).toBe('new comment on #15');
      // No detail fetch for comments (page 1 + page 2 empty)
      expect(mockLaunch).toHaveBeenCalledTimes(2);
    });

    it('maps DiscussionNote with "commented on" to comment.created', async () => {
      mockEventsList([noteEvent({ id: 31, target_type: 'DiscussionNote' })]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('comment.created');
    });

    it('drops Note events whose action does not start with "commented on"', async () => {
      mockEventsList([noteEvent({ action_name: 'updated' })]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(0);
    });

    it('drops system notes (note.system: true)', async () => {
      mockEventsList([
        noteEvent({ note: { body: 'added ~bug label', system: true } }),
      ]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(0);
    });

    it('drops notes containing ROVER_FOOTER_MARKER', async () => {
      mockEventsList([
        noteEvent({
          note: {
            body: `Report\n<details>\n${ROVER_FOOTER_MARKER}\n</details>`,
            system: false,
          },
        }),
      ]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(0);
    });

    it('truncates note body to 200 characters in meta', async () => {
      const longBody = 'z'.repeat(400);
      mockEventsList([noteEvent({ note: { body: longBody, system: false } })]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect((events[0].meta.body as string).length).toBe(200);
    });

    it('handles null/missing note body gracefully', async () => {
      mockEventsList([noteEvent({ note: { system: false } })]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].meta.body).toBe('');
    });

    it('handles missing note object gracefully', async () => {
      mockEventsList([noteEvent({ note: undefined })]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].meta.body).toBe('');
    });

    it('includes noteId in meta from target_id', async () => {
      mockEventsList([noteEvent({ target_id: 555 })]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events[0].meta.noteId).toBe(555);
    });

    it('uses target_id when target_iid is missing for summary', async () => {
      mockEventsList([noteEvent({ target_id: 77, target_iid: undefined })]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events[0].summary).toBe('new comment on #77');
    });
  });

  // ── DiffNote events (review_comment.created) ────────────────────────

  describe('DiffNote events (review_comment.created)', () => {
    const diffNoteEvent = (overrides: Record<string, unknown> = {}) =>
      glEvent({
        id: 40,
        action_name: 'commented on',
        target_type: 'DiffNote',
        target_id: 300,
        target_iid: 20,
        target_title: null,
        note: { body: 'Consider refactoring this.', system: false },
        ...overrides,
      });

    it('maps DiffNote with "commented on" to review_comment.created', async () => {
      mockEventsList([diffNoteEvent()]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('review_comment.created');
      expect(events[0].summary).toBe('new comment on #20');
    });

    it('drops DiffNote system notes', async () => {
      mockEventsList([
        diffNoteEvent({ note: { body: 'system change', system: true } }),
      ]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(0);
    });

    it('drops DiffNote with ROVER_FOOTER_MARKER', async () => {
      mockEventsList([
        diffNoteEvent({
          note: {
            body: `Some text ${ROVER_FOOTER_MARKER} more text`,
            system: false,
          },
        }),
      ]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(0);
    });

    it('drops DiffNote when action is not "commented on"', async () => {
      mockEventsList([diffNoteEvent({ action_name: 'created' })]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(0);
    });
  });

  // ── Push events ─────────────────────────────────────────────────────

  describe('Push events', () => {
    const pushEvent = (overrides: Record<string, unknown> = {}) =>
      glEvent({
        id: 50,
        action_name: 'pushed to',
        target_type: null,
        target_id: null,
        target_title: null,
        push_data: {
          ref: 'main',
          ref_type: 'branch',
          commit_count: 3,
          commit_title: 'feat: add feature',
          commit_to: 'abc123',
        },
        ...overrides,
      });

    it('maps "pushed to" to push kind', async () => {
      mockEventsList([pushEvent()]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('push');
      expect(events[0].summary).toBe('new push to main');
      // No detail fetch for push events (page 1 + page 2 empty)
      expect(mockLaunch).toHaveBeenCalledTimes(2);
    });

    it('maps "pushed new" to push kind', async () => {
      mockEventsList([pushEvent({ id: 51, action_name: 'pushed new' })]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('push');
    });

    it('maps push_data fields correctly', async () => {
      mockEventsList([pushEvent()]);

      const events = await fetcher.fetchEvents(repo, noStop);
      const meta = events[0].meta;
      expect(meta.ref).toBe('main');
      expect(meta.refType).toBe('branch');
      expect(meta.commitCount).toBe(3);
      expect(meta.headSha).toBe('abc123');
      expect(meta.commits).toEqual([
        { sha: 'abc123', message: 'feat: add feature' },
      ]);
    });

    it('handles missing push_data — ref shows "unknown", empty commits', async () => {
      mockEventsList([pushEvent({ push_data: undefined })]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].summary).toBe('new push to unknown');
      expect(events[0].meta.ref).toBeUndefined();
      expect(events[0].meta.commitCount).toBe(0);
      expect(events[0].meta.commits).toEqual([]);
    });

    it('handles missing commit_title — empty commits array', async () => {
      mockEventsList([
        pushEvent({
          push_data: {
            ref: 'develop',
            ref_type: 'branch',
            commit_count: 1,
            commit_title: '',
            commit_to: 'def456',
          },
        }),
      ]);

      const events = await fetcher.fetchEvents(repo, noStop);
      // Empty string is falsy, so commits should be empty
      expect(events[0].meta.commits).toEqual([]);
    });

    it('creates commit entry when commit_title is present', async () => {
      mockEventsList([
        pushEvent({
          push_data: {
            ref: 'main',
            ref_type: 'branch',
            commit_count: 1,
            commit_title: 'fix: resolve issue',
            commit_to: 'sha999',
          },
        }),
      ]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events[0].meta.commits).toEqual([
        { sha: 'sha999', message: 'fix: resolve issue' },
      ]);
    });
  });

  // ── Unknown target types / actions ──────────────────────────────────

  describe('Unknown target types and actions', () => {
    it('drops events with unknown target_type', async () => {
      mockEventsList([
        glEvent({
          action_name: 'created',
          target_type: 'Snippet',
        }),
      ]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(0);
    });

    it('drops events with null target_type and non-push action', async () => {
      mockEventsList([
        glEvent({
          action_name: 'deleted',
          target_type: null,
        }),
      ]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(0);
    });
  });

  // ── Bot name filtering ──────────────────────────────────────────────

  describe('Bot name filtering', () => {
    it('skips bot events before normalization (no detail API calls)', async () => {
      const botFetcher = new GitLabFetcher('/tmp/test', {
        botName: 'rover-bot',
      });

      mockEventsList([
        glEvent({
          id: 60,
          action_name: 'opened',
          target_type: 'MergeRequest',
          target_iid: 99,
          author: { username: 'Rover-Bot' },
        }),
      ]);

      const events = await botFetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(0);
      // Only the events list call — no detail fetch for the bot's MR (+ page 2 empty)
      expect(mockLaunch).toHaveBeenCalledTimes(2);
    });

    it('matches bot name case-insensitively', async () => {
      const botFetcher = new GitLabFetcher('/tmp/test', {
        botName: 'MyBot',
      });

      mockEventsList([
        glEvent({
          id: 61,
          author: { username: 'mybot' },
        }),
      ]);

      const events = await botFetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(0);
    });

    it('passes through events when no botName is configured', async () => {
      const noBotFetcher = new GitLabFetcher('/tmp/test');

      mockEventsList([
        glEvent({
          id: 62,
          author: { username: 'rover-bot' },
        }),
      ]);
      mockDetailResponse(issueDetail());

      const events = await noBotFetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
    });

    it('filters bot events but processes human events with detail calls', async () => {
      const botFetcher = new GitLabFetcher('/tmp/test', {
        botName: 'bot-user',
      });

      mockEventsList([
        glEvent({
          id: 70,
          action_name: 'opened',
          target_type: 'Issue',
          target_iid: 10,
          author: { username: 'Bot-User' },
        }),
        glEvent({
          id: 71,
          action_name: 'opened',
          target_type: 'Issue',
          target_iid: 11,
          author: { username: 'human' },
        }),
      ]);
      // Only one detail call for the human event
      mockDetailResponse(issueDetail({ title: 'Human issue' }));

      const events = await botFetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].actor).toBe('human');
      // events list + 1 detail + page 2 empty = 3 calls total
      expect(mockLaunch).toHaveBeenCalledTimes(3);
    });
  });

  // ── resolveActors ───────────────────────────────────────────────────

  describe('resolveActors', () => {
    it('returns members with access_level >= 30 (Developer+)', async () => {
      mockLaunch.mockResolvedValueOnce({
        failed: false,
        stdout: JSON.stringify([
          { username: 'dev', access_level: 30 },
          { username: 'maintainer', access_level: 40 },
          { username: 'owner', access_level: 50 },
        ]),
      } as MockResult);

      const actors = await fetcher.resolveActors(repo, 'maintainers');
      expect(actors).toEqual(['dev', 'maintainer', 'owner']);
    });

    it('filters out Guest (10) and Reporter (20)', async () => {
      mockLaunch.mockResolvedValueOnce({
        failed: false,
        stdout: JSON.stringify([
          { username: 'guest', access_level: 10 },
          { username: 'reporter', access_level: 20 },
          { username: 'developer', access_level: 30 },
        ]),
      } as MockResult);

      const actors = await fetcher.resolveActors(repo, 'maintainers');
      expect(actors).toEqual(['developer']);
    });

    it('returns empty array on API failure', async () => {
      mockLaunch.mockResolvedValueOnce({
        failed: true,
        stdout: '',
      } as MockResult);

      const actors = await fetcher.resolveActors(repo, 'maintainers');
      expect(actors).toEqual([]);
    });

    it('returns empty array on empty stdout', async () => {
      mockLaunch.mockResolvedValueOnce({
        failed: false,
        stdout: '',
      } as MockResult);

      const actors = await fetcher.resolveActors(repo, 'maintainers');
      expect(actors).toEqual([]);
    });

    it('calls glab api with correct members URL and cwd', async () => {
      mockLaunch.mockResolvedValueOnce({
        failed: false,
        stdout: JSON.stringify([]),
      } as MockResult);

      await fetcher.resolveActors(repo, 'maintainers');

      expect(mockLaunch).toHaveBeenCalledWith(
        'glab',
        ['api', 'projects/:id/members/all'],
        { cwd: '/tmp/test' }
      );
    });
  });

  // ── ID conversion ──────────────────────────────────────────────────

  describe('ID conversion', () => {
    it('converts GitLab integer IDs to strings in NormEvent.id', async () => {
      mockEventsList([glEvent({ id: 12345 })]);
      mockDetailResponse(issueDetail());

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events[0].id).toBe('12345');
      expect(typeof events[0].id).toBe('string');
    });
  });

  // ── Multiple events in single response ─────────────────────────────

  describe('Multiple events in single response', () => {
    it('processes a mix of different event types', async () => {
      mockEventsList([
        glEvent({
          id: 80,
          action_name: 'opened',
          target_type: 'Issue',
          target_iid: 1,
        }),
        glEvent({
          id: 81,
          action_name: 'opened',
          target_type: 'MergeRequest',
          target_iid: 2,
          author: { username: 'bob' },
        }),
        glEvent({
          id: 82,
          action_name: 'commented on',
          target_type: 'Note',
          target_id: 300,
          target_iid: 3,
          note: { body: 'Nice!', system: false },
          author: { username: 'charlie' },
        }),
        glEvent({
          id: 83,
          action_name: 'pushed to',
          target_type: null,
          target_id: null,
          push_data: {
            ref: 'main',
            ref_type: 'branch',
            commit_count: 1,
            commit_title: 'fix',
            commit_to: 'sha1',
          },
          author: { username: 'dave' },
        }),
      ]);
      // Detail for issue (id 80)
      mockDetailResponse(issueDetail({ title: 'Issue 1' }));
      // Detail for MR (id 81)
      mockDetailResponse(mrDetail({ title: 'MR 2' }));

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(4);
      expect(events[0].kind).toBe('issue.opened');
      expect(events[1].kind).toBe('pr.opened');
      expect(events[2].kind).toBe('comment.created');
      expect(events[3].kind).toBe('push');
      // 1 events list + 2 detail calls (issue + MR) + page 2 empty
      expect(mockLaunch).toHaveBeenCalledTimes(4);
    });

    it('drops unmappable events while keeping valid ones', async () => {
      mockEventsList([
        glEvent({
          id: 90,
          action_name: 'updated',
          target_type: 'Issue',
        }),
        glEvent({
          id: 91,
          action_name: 'commented on',
          target_type: 'Note',
          target_id: 400,
          target_iid: 5,
          note: { body: 'Keep this', system: false },
        }),
        glEvent({
          id: 92,
          action_name: 'labeled',
          target_type: 'MergeRequest',
        }),
      ]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe('comment.created');
      // Only the events list call + page 2 empty — no detail fetches since Issue was dropped and MR was dropped
      expect(mockLaunch).toHaveBeenCalledTimes(2);
    });

    it('each issue/MR triggers its own detail fetch', async () => {
      mockEventsList([
        glEvent({
          id: 100,
          action_name: 'opened',
          target_type: 'Issue',
          target_iid: 10,
        }),
        glEvent({
          id: 101,
          action_name: 'closed',
          target_type: 'Issue',
          target_iid: 11,
          author: { username: 'bob' },
        }),
      ]);
      mockDetailResponse(issueDetail({ title: 'First' }));
      mockDetailResponse(issueDetail({ title: 'Second', state: 'closed' }));

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(2);
      // 1 events list + 2 detail calls + page 2 empty
      expect(mockLaunch).toHaveBeenCalledTimes(4);
      expect(mockLaunch).toHaveBeenNthCalledWith(
        2,
        'glab',
        ['api', 'projects/:id/issues/10'],
        { cwd: '/tmp/test' }
      );
      expect(mockLaunch).toHaveBeenNthCalledWith(
        3,
        'glab',
        ['api', 'projects/:id/issues/11'],
        { cwd: '/tmp/test' }
      );
    });
  });

  // ── source property ─────────────────────────────────────────────────

  describe('source property', () => {
    it('has source set to "gitlab"', () => {
      expect(fetcher.source).toBe('gitlab');
    });

    it('sets source to "gitlab" on all normalized events', async () => {
      mockEventsList([
        glEvent({
          id: 110,
          action_name: 'pushed to',
          target_type: null,
          push_data: {
            ref: 'main',
            ref_type: 'branch',
            commit_count: 1,
            commit_title: 'test',
            commit_to: 'sha',
          },
        }),
      ]);

      const events = await fetcher.fetchEvents(repo, noStop);
      expect(events[0].source).toBe('gitlab');
    });
  });

  // ── Constructor ─────────────────────────────────────────────────────

  describe('constructor', () => {
    it('uses provided cwd for API calls', async () => {
      const customFetcher = new GitLabFetcher('/custom/path');
      mockEventsList([]);

      await customFetcher.fetchEvents(repo, noStop);

      expect(mockLaunch).toHaveBeenCalledWith('glab', expect.any(Array), {
        cwd: '/custom/path',
      });
    });

    it('handles undefined botName without filtering', async () => {
      const noOptsFetcher = new GitLabFetcher('/tmp/test');
      mockEventsList([glEvent({ author: { username: 'anyone' } })]);
      mockDetailResponse(issueDetail());

      const events = await noOptsFetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
    });

    it('handles empty opts object without filtering', async () => {
      const emptyOptsFetcher = new GitLabFetcher('/tmp/test', {});
      mockEventsList([glEvent({ author: { username: 'anyone' } })]);
      mockDetailResponse(issueDetail());

      const events = await emptyOptsFetcher.fetchEvents(repo, noStop);
      expect(events).toHaveLength(1);
    });
  });
});
