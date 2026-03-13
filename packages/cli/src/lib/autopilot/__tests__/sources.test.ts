import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRemoteUrl = vi.fn<() => string | undefined>();

// Mock rover-core before importing anything that depends on it
vi.mock('rover-core', async () => {
  const actual =
    await vi.importActual<typeof import('rover-core')>('rover-core');
  return {
    ...actual,
    launch: vi.fn(),
    getProjectPath: () => '/tmp/test',
    Git: vi.fn().mockImplementation(() => ({
      remoteUrl: mockRemoteUrl,
    })),
  };
});

import { launch } from 'rover-core';
import {
  detectSource,
  detectSourceWithProbe,
  parseRepoInfo,
  getRepoInfo,
} from '../sources/detect.js';
import { GitHubFetcher } from '../sources/github.js';
import { GitLabFetcher } from '../sources/gitlab.js';
import { ROVER_FOOTER_MARKER } from '../helpers.js';
import type { RepoInfo } from '../sources/types.js';

const mockLaunch = launch as unknown as ReturnType<typeof vi.fn>;

/** Minimal shape that satisfies the subset of execa's Result we actually use. */
type MockResult = { failed: boolean; stdout: string };

describe('detectSource', () => {
  it('detects GitHub from SSH URL', () => {
    expect(detectSource('git@github.com:owner/repo.git')).toBe('github');
  });

  it('detects GitHub from HTTPS URL', () => {
    expect(detectSource('https://github.com/owner/repo.git')).toBe('github');
  });

  it('detects GitLab from SSH URL', () => {
    expect(detectSource('git@gitlab.com:group/project.git')).toBe('gitlab');
  });

  it('detects GitLab from HTTPS URL', () => {
    expect(detectSource('https://gitlab.com/group/sub/project.git')).toBe(
      'gitlab'
    );
  });

  it('detects GitHub from SSH alias containing "github"', () => {
    expect(detectSource('github-personal:owner/repo.git')).toBe('github');
  });

  it('returns null for unknown host', () => {
    expect(detectSource('git@selfhosted.example.com:org/repo.git')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectSource('')).toBeNull();
  });
});

describe('parseRepoInfo', () => {
  it('parses GitHub SSH URL', () => {
    const info = parseRepoInfo('git@github.com:owner/repo.git');
    expect(info).toEqual({
      source: 'github',
      fullPath: 'owner/repo',
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses GitHub HTTPS URL', () => {
    const info = parseRepoInfo('https://github.com/owner/repo.git');
    expect(info).toEqual({
      source: 'github',
      fullPath: 'owner/repo',
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses GitLab HTTPS URL with nested groups', () => {
    const info = parseRepoInfo('https://gitlab.com/group/subgroup/project.git');
    expect(info).toEqual({
      source: 'gitlab',
      fullPath: 'group/subgroup/project',
      owner: 'group',
      repo: 'project',
    });
  });

  it('parses GitLab SSH URL', () => {
    const info = parseRepoInfo('git@gitlab.com:group/project.git');
    expect(info).toEqual({
      source: 'gitlab',
      fullPath: 'group/project',
      owner: 'group',
      repo: 'project',
    });
  });

  it('handles URLs without .git suffix', () => {
    const info = parseRepoInfo('https://github.com/owner/repo');
    expect(info).toEqual({
      source: 'github',
      fullPath: 'owner/repo',
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('returns null for unknown host', () => {
    expect(parseRepoInfo('git@selfhosted.example.com:org/repo.git')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseRepoInfo('')).toBeNull();
  });

  it('uses explicit source, skipping hostname detection', () => {
    const info = parseRepoInfo(
      'git@selfhosted.example.com:org/repo.git',
      'gitlab'
    );
    expect(info).toEqual({
      source: 'gitlab',
      fullPath: 'org/repo',
      owner: 'org',
      repo: 'repo',
    });
  });

  it('uses explicit source for GitHub on self-hosted URL', () => {
    const info = parseRepoInfo(
      'https://git.company.io/team/project.git',
      'github'
    );
    expect(info).toEqual({
      source: 'github',
      fullPath: 'team/project',
      owner: 'team',
      repo: 'project',
    });
  });
});

describe('detectSourceWithProbe', () => {
  beforeEach(() => {
    mockLaunch.mockReset();
  });

  it('returns gitlab when glab probe succeeds', async () => {
    mockLaunch.mockResolvedValueOnce({
      failed: false,
      stdout: '{}',
    } as MockResult);

    const result = await detectSourceWithProbe(
      'git@git.company.io:org/repo.git',
      '/tmp/project'
    );
    expect(result).toBe('gitlab');
    expect(mockLaunch).toHaveBeenCalledWith('glab', ['api', 'projects/:id'], {
      cwd: '/tmp/project',
    });
  });

  it('returns github when glab fails but gh probe succeeds', async () => {
    mockLaunch
      .mockResolvedValueOnce({ failed: true, stdout: '' } as MockResult)
      .mockResolvedValueOnce({ failed: false, stdout: '{}' } as MockResult);

    const result = await detectSourceWithProbe(
      'git@git.company.io:org/repo.git',
      '/tmp/project'
    );
    expect(result).toBe('github');
    expect(mockLaunch).toHaveBeenCalledWith('gh', ['api', 'repos/org/repo']);
  });

  it('returns null when both probes fail', async () => {
    mockLaunch
      .mockResolvedValueOnce({ failed: true, stdout: '' } as MockResult)
      .mockResolvedValueOnce({ failed: true, stdout: '' } as MockResult);

    const result = await detectSourceWithProbe(
      'git@git.company.io:org/repo.git',
      '/tmp/project'
    );
    expect(result).toBeNull();
  });

  it('returns null when glab throws and gh fails', async () => {
    mockLaunch
      .mockRejectedValueOnce(new Error('glab not found'))
      .mockResolvedValueOnce({ failed: true, stdout: '' } as MockResult);

    const result = await detectSourceWithProbe(
      'git@git.company.io:org/repo.git',
      '/tmp/project'
    );
    expect(result).toBeNull();
  });

  it('returns github when glab throws but gh succeeds', async () => {
    mockLaunch
      .mockRejectedValueOnce(new Error('glab not found'))
      .mockResolvedValueOnce({ failed: false, stdout: '{}' } as MockResult);

    const result = await detectSourceWithProbe(
      'git@git.company.io:org/repo.git',
      '/tmp/project'
    );
    expect(result).toBe('github');
  });

  it('returns null when path cannot be extracted (no gh probe)', async () => {
    mockLaunch.mockResolvedValueOnce({
      failed: true,
      stdout: '',
    } as MockResult);

    const result = await detectSourceWithProbe('', '/tmp/project');
    expect(result).toBeNull();
    // Only glab was attempted, no gh probe because path is empty
    expect(mockLaunch).toHaveBeenCalledTimes(1);
  });

  it('skips gh probe when path has fewer than 2 segments', async () => {
    mockLaunch.mockResolvedValueOnce({
      failed: true,
      stdout: '',
    } as MockResult);

    const result = await detectSourceWithProbe(
      'git@git.company.io:single',
      '/tmp/project'
    );
    expect(result).toBeNull();
    expect(mockLaunch).toHaveBeenCalledTimes(1);
  });
});

describe('getRepoInfo', () => {
  beforeEach(() => {
    mockLaunch.mockReset();
    mockRemoteUrl.mockReset();
  });

  it('returns null when no remote URL', async () => {
    mockRemoteUrl.mockReturnValue(undefined);
    const result = await getRepoInfo('/tmp/project');
    expect(result).toBeNull();
  });

  it('returns repo info via fast hostname detection (GitHub)', async () => {
    mockRemoteUrl.mockReturnValue('git@github.com:owner/repo.git');
    const result = await getRepoInfo('/tmp/project');
    expect(result).toEqual({
      source: 'github',
      fullPath: 'owner/repo',
      owner: 'owner',
      repo: 'repo',
    });
    // No CLI probes needed
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('returns repo info via fast hostname detection (GitLab)', async () => {
    mockRemoteUrl.mockReturnValue(
      'https://gitlab.com/group/subgroup/project.git'
    );
    const result = await getRepoInfo('/tmp/project');
    expect(result).toEqual({
      source: 'gitlab',
      fullPath: 'group/subgroup/project',
      owner: 'group',
      repo: 'project',
    });
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('falls back to CLI probe for self-hosted GitLab', async () => {
    mockRemoteUrl.mockReturnValue('git@git.company.io:team/project.git');
    mockLaunch.mockResolvedValueOnce({
      failed: false,
      stdout: '{}',
    } as MockResult);

    const result = await getRepoInfo('/tmp/project');
    expect(result).toEqual({
      source: 'gitlab',
      fullPath: 'team/project',
      owner: 'team',
      repo: 'project',
    });
  });

  it('falls back to CLI probe for self-hosted GitHub', async () => {
    mockRemoteUrl.mockReturnValue('git@git.company.io:team/project.git');
    mockLaunch
      .mockResolvedValueOnce({ failed: true, stdout: '' } as MockResult)
      .mockResolvedValueOnce({ failed: false, stdout: '{}' } as MockResult);

    const result = await getRepoInfo('/tmp/project');
    expect(result).toEqual({
      source: 'github',
      fullPath: 'team/project',
      owner: 'team',
      repo: 'project',
    });
  });

  it('returns null when both probes fail for unknown host', async () => {
    mockRemoteUrl.mockReturnValue('git@git.company.io:team/project.git');
    mockLaunch
      .mockResolvedValueOnce({ failed: true, stdout: '' } as MockResult)
      .mockResolvedValueOnce({ failed: true, stdout: '' } as MockResult);

    const result = await getRepoInfo('/tmp/project');
    expect(result).toBeNull();
  });
});

describe('GitHubFetcher', () => {
  const fetcher = new GitHubFetcher();
  const repo: RepoInfo = {
    source: 'github',
    fullPath: 'owner/repo',
    owner: 'owner',
    repo: 'repo',
  };

  beforeEach(() => {
    mockLaunch.mockReset();
  });

  it('maps IssuesEvent opened to issue.opened', async () => {
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify({
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
      }),
    } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('issue.opened');
    expect(events[0].actor).toBe('alice');
    expect(events[0].summary).toBe('issue opened #42');
  });

  it('maps PullRequestEvent closed+merged to pr.merged', async () => {
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify({
        id: '2',
        type: 'PullRequestEvent',
        actor: { login: 'bob' },
        created_at: '2024-01-01T00:00:00Z',
        payload: {
          action: 'closed',
          pull_request: {
            number: 10,
            title: 'Fix bug',
            state: 'closed',
            merged: true,
            user: { login: 'bob' },
            labels: [],
            assignees: [],
            requested_reviewers: [],
            head: { ref: 'fix-bug' },
            base: { ref: 'main' },
            html_url: 'https://github.com/owner/repo/pull/10',
          },
        },
      }),
    } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('pr.merged');
    expect(events[0].summary).toBe('PR merged #10');
  });

  it('maps PushEvent to push', async () => {
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify({
        id: '3',
        type: 'PushEvent',
        actor: { login: 'charlie' },
        created_at: '2024-01-01T00:00:00Z',
        payload: {
          ref: 'refs/heads/main',
          size: 2,
          head: 'abc123',
          commits: [
            { sha: 'abc123', message: 'feat: add feature' },
            { sha: 'def456', message: 'fix: fix bug' },
          ],
        },
      }),
    } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('push');
    expect(events[0].meta.commitCount).toBe(2);
  });

  it('filters out IssueCommentEvent with Rover footer marker', async () => {
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify({
        id: '4',
        type: 'IssueCommentEvent',
        actor: { login: 'rover-bot' },
        created_at: '2024-01-01T00:00:00Z',
        payload: {
          action: 'created',
          issue: { number: 1, title: 'Test', state: 'open' },
          comment: {
            id: 123,
            user: { login: 'rover-bot' },
            body: `Some message\n\n<details>\n${ROVER_FOOTER_MARKER}\n</details>`,
          },
        },
      }),
    } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(0);
  });

  it('passes through IssueCommentEvent without Rover footer', async () => {
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify({
        id: '5',
        type: 'IssueCommentEvent',
        actor: { login: 'human' },
        created_at: '2024-01-01T00:00:00Z',
        payload: {
          action: 'created',
          issue: { number: 1, title: 'Test', state: 'open' },
          comment: {
            id: 124,
            user: { login: 'human' },
            body: 'Please review the changes.',
          },
        },
      }),
    } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('comment.created');
  });

  it('filters out PullRequestReviewEvent with Rover footer marker', async () => {
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify({
        id: '6',
        type: 'PullRequestReviewEvent',
        actor: { login: 'rover-bot' },
        created_at: '2024-01-01T00:00:00Z',
        payload: {
          action: 'submitted',
          pull_request: { number: 10, title: 'PR', state: 'open' },
          review: {
            user: { login: 'rover-bot' },
            state: 'COMMENTED',
            body: `Review\n\n<details>\n${ROVER_FOOTER_MARKER}\n</details>`,
          },
        },
      }),
    } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(0);
  });

  it('drops events with irrelevant actions', async () => {
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify({
        id: '7',
        type: 'IssuesEvent',
        actor: { login: 'alice' },
        created_at: '2024-01-01T00:00:00Z',
        payload: { action: 'labeled' },
      }),
    } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(0);
  });

  it('maps PullRequestReviewCommentEvent to review_comment.created', async () => {
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify({
        id: '8',
        type: 'PullRequestReviewCommentEvent',
        actor: { login: 'reviewer' },
        created_at: '2024-01-01T00:00:00Z',
        payload: {
          action: 'created',
          pull_request: { number: 20, title: 'PR2', state: 'open' },
          comment: {
            id: 457,
            user: { login: 'reviewer' },
            path: 'src/bar.ts',
            body: 'Consider renaming this variable.',
          },
        },
      }),
    } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('review_comment.created');
  });

  it('resolves collaborators as actors', async () => {
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: 'alice\nbob\n',
    } as MockResult);

    const actors = await fetcher.resolveActors(repo, 'maintainers');
    expect(actors).toEqual(['alice', 'bob']);
  });

  it('skips events authored by botName (case-insensitive)', async () => {
    const botFetcher = new GitHubFetcher({ botName: 'rover-bot' });
    const botEvent = JSON.stringify({
      id: '100',
      type: 'IssuesEvent',
      actor: { login: 'Rover-Bot' },
      created_at: '2024-01-01T00:00:00Z',
      payload: {
        action: 'opened',
        issue: {
          number: 1,
          title: 'Bot issue',
          state: 'open',
          user: { login: 'Rover-Bot' },
          labels: [],
          assignees: [],
          html_url: '',
        },
      },
    });
    const humanEvent = JSON.stringify({
      id: '101',
      type: 'IssuesEvent',
      actor: { login: 'alice' },
      created_at: '2024-01-01T00:00:00Z',
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
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: `${botEvent}\n${humanEvent}`,
    } as MockResult);

    const events = await botFetcher.fetchEvents(repo);
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe('alice');
  });
});

describe('GitLabFetcher', () => {
  const fetcher = new GitLabFetcher('/tmp/test');
  const repo: RepoInfo = {
    source: 'gitlab',
    fullPath: 'group/project',
    owner: 'group',
    repo: 'project',
  };

  beforeEach(() => {
    mockLaunch.mockReset();
  });

  it('maps opened Issue to issue.opened with enriched data', async () => {
    // First call: events list; second call: issue detail
    mockLaunch
      .mockResolvedValueOnce({
        failed: false,
        stdout: JSON.stringify([
          {
            id: 100,
            action_name: 'opened',
            target_type: 'Issue',
            target_id: 1,
            target_iid: 42,
            target_title: 'Bug report',
            author: { username: 'alice' },
            created_at: '2024-01-01T00:00:00Z',
          },
        ]),
      } as MockResult)
      .mockResolvedValueOnce({
        failed: false,
        stdout: JSON.stringify({
          title: 'Bug report',
          description: 'Steps to reproduce the bug...',
          state: 'opened',
          author: { username: 'alice' },
          labels: ['bug', 'critical'],
          assignees: [{ username: 'bob' }],
          web_url: 'https://gitlab.com/group/project/-/issues/42',
        }),
      } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('issue.opened');
    expect(events[0].id).toBe('100');
    expect(events[0].actor).toBe('alice');
    expect(events[0].meta.body).toBe('Steps to reproduce the bug...');
    expect(events[0].meta.labels).toEqual(['bug', 'critical']);
    expect(events[0].meta.assignees).toEqual(['bob']);
    expect(events[0].meta.url).toBe(
      'https://gitlab.com/group/project/-/issues/42'
    );
  });

  it('maps accepted MergeRequest to pr.merged with enriched data', async () => {
    mockLaunch
      .mockResolvedValueOnce({
        failed: false,
        stdout: JSON.stringify([
          {
            id: 101,
            action_name: 'accepted',
            target_type: 'MergeRequest',
            target_id: 5,
            target_iid: 10,
            target_title: 'Fix bug',
            author: { username: 'bob' },
            created_at: '2024-01-01T00:00:00Z',
          },
        ]),
      } as MockResult)
      .mockResolvedValueOnce({
        failed: false,
        stdout: JSON.stringify({
          title: 'Fix bug',
          description: 'This MR fixes the login bug',
          state: 'merged',
          draft: false,
          author: { username: 'bob' },
          source_branch: 'fix-bug',
          target_branch: 'main',
          labels: ['bugfix'],
          assignees: [{ username: 'bob' }],
          reviewers: [{ username: 'alice' }],
          web_url: 'https://gitlab.com/group/project/-/merge_requests/10',
        }),
      } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('pr.merged');
    expect(events[0].summary).toBe('MR merged !10');
    expect(events[0].meta.body).toBe('This MR fixes the login bug');
    expect(events[0].meta.branch).toBe('fix-bug');
    expect(events[0].meta.baseBranch).toBe('main');
    expect(events[0].meta.merged).toBe(true);
    expect(events[0].meta.reviewers).toEqual(['alice']);
  });

  it('maps approved MergeRequest to pr.approved', async () => {
    mockLaunch
      .mockResolvedValueOnce({
        failed: false,
        stdout: JSON.stringify([
          {
            id: 102,
            action_name: 'approved',
            target_type: 'MergeRequest',
            target_id: 6,
            target_iid: 11,
            target_title: 'Add feature',
            author: { username: 'charlie' },
            created_at: '2024-01-01T00:00:00Z',
          },
        ]),
      } as MockResult)
      .mockResolvedValueOnce({
        failed: false,
        stdout: JSON.stringify({
          title: 'Add feature',
          description: '',
          state: 'opened',
          draft: false,
          author: { username: 'charlie' },
          source_branch: 'feat',
          target_branch: 'main',
          labels: [],
          assignees: [],
          reviewers: [],
          web_url: 'https://gitlab.com/group/project/-/merge_requests/11',
        }),
      } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('pr.approved');
  });

  it('maps push event with push_data', async () => {
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify([
        {
          id: 103,
          action_name: 'pushed to',
          target_type: 'Project',
          target_id: null,
          target_title: null,
          author: { username: 'dev' },
          created_at: '2024-01-01T00:00:00Z',
          push_data: {
            ref: 'main',
            ref_type: 'branch',
            commit_count: 3,
            commit_title: 'feat: add feature',
            commit_to: 'abc123',
          },
        },
      ]),
    } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('push');
    expect(events[0].meta.commitCount).toBe(3);
    expect(events[0].meta.ref).toBe('main');
  });

  it('maps DiffNote comment to review_comment.created', async () => {
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify([
        {
          id: 104,
          action_name: 'commented on',
          target_type: 'DiffNote',
          target_id: 200,
          target_iid: 15,
          target_title: null,
          author: { username: 'reviewer' },
          created_at: '2024-01-01T00:00:00Z',
          note: { body: 'Consider refactoring this.', system: false },
        },
      ]),
    } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('review_comment.created');
  });

  it('maps Note comment to comment.created', async () => {
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify([
        {
          id: 105,
          action_name: 'commented on',
          target_type: 'Note',
          target_id: 201,
          target_iid: 16,
          target_title: null,
          author: { username: 'user' },
          created_at: '2024-01-01T00:00:00Z',
          note: { body: 'Thanks for the fix!', system: false },
        },
      ]),
    } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('comment.created');
  });

  it('skips system notes', async () => {
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify([
        {
          id: 106,
          action_name: 'commented on',
          target_type: 'Note',
          target_id: 202,
          target_title: null,
          author: { username: 'system' },
          created_at: '2024-01-01T00:00:00Z',
          note: { body: 'added ~bug label', system: true },
        },
      ]),
    } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(0);
  });

  it('skips self-generated Rover comments', async () => {
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify([
        {
          id: 107,
          action_name: 'commented on',
          target_type: 'Note',
          target_id: 203,
          target_title: null,
          author: { username: 'rover-bot' },
          created_at: '2024-01-01T00:00:00Z',
          note: {
            body: `Report\n<details>\n${ROVER_FOOTER_MARKER}\n</details>`,
            system: false,
          },
        },
      ]),
    } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(0);
  });

  it('resolves members with Developer+ access', async () => {
    mockLaunch.mockResolvedValue({
      failed: false,
      stdout: JSON.stringify([
        { username: 'dev', access_level: 30 },
        { username: 'guest', access_level: 10 },
        { username: 'maintainer', access_level: 40 },
      ]),
    } as MockResult);

    const actors = await fetcher.resolveActors(repo, 'maintainers');
    expect(actors).toEqual(['dev', 'maintainer']);
  });

  it('maps closed Issue to issue.closed', async () => {
    mockLaunch
      .mockResolvedValueOnce({
        failed: false,
        stdout: JSON.stringify([
          {
            id: 108,
            action_name: 'closed',
            target_type: 'Issue',
            target_id: 2,
            target_iid: 43,
            target_title: 'Stale issue',
            author: { username: 'bob' },
            created_at: '2024-01-01T00:00:00Z',
          },
        ]),
      } as MockResult)
      .mockResolvedValueOnce({
        failed: false,
        stdout: JSON.stringify({
          title: 'Stale issue',
          description: '',
          state: 'closed',
          author: { username: 'bob' },
          labels: [],
          assignees: [],
          web_url: 'https://gitlab.com/group/project/-/issues/43',
        }),
      } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('issue.closed');
    expect(events[0].meta.state).toBe('closed');
  });

  it('maps closed WorkItem to issue.closed', async () => {
    mockLaunch
      .mockResolvedValueOnce({
        failed: false,
        stdout: JSON.stringify([
          {
            id: 109,
            action_name: 'closed',
            target_type: 'WorkItem',
            target_id: 3,
            target_iid: 44,
            target_title: 'Task',
            author: { username: 'charlie' },
            created_at: '2024-01-01T00:00:00Z',
          },
        ]),
      } as MockResult)
      .mockResolvedValueOnce({
        failed: false,
        stdout: JSON.stringify({
          title: 'Task',
          description: '',
          state: 'closed',
          author: { username: 'charlie' },
          labels: [],
          assignees: [],
          web_url: 'https://gitlab.com/group/project/-/issues/44',
        }),
      } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('issue.closed');
  });

  it('gracefully handles failed detail fetch', async () => {
    mockLaunch
      .mockResolvedValueOnce({
        failed: false,
        stdout: JSON.stringify([
          {
            id: 110,
            action_name: 'opened',
            target_type: 'MergeRequest',
            target_id: 7,
            target_iid: 20,
            target_title: 'Some MR',
            author: { username: 'dev' },
            created_at: '2024-01-01T00:00:00Z',
          },
        ]),
      } as MockResult)
      .mockResolvedValueOnce({ failed: true, stdout: '' } as MockResult);

    const events = await fetcher.fetchEvents(repo);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('pr.opened');
    // Falls back to event-level title
    expect(events[0].meta.title).toBe('Some MR');
  });

  it('skips events authored by botName without calling detail APIs', async () => {
    const botFetcher = new GitLabFetcher('/tmp/test', { botName: 'rover-bot' });
    mockLaunch
      .mockResolvedValueOnce({
        failed: false,
        stdout: JSON.stringify([
          {
            id: 200,
            action_name: 'opened',
            target_type: 'MergeRequest',
            target_id: 50,
            target_iid: 99,
            target_title: 'Bot MR',
            author: { username: 'Rover-Bot' },
            created_at: '2024-01-01T00:00:00Z',
          },
          {
            id: 201,
            action_name: 'opened',
            target_type: 'Issue',
            target_id: 51,
            target_iid: 100,
            target_title: 'Human issue',
            author: { username: 'alice' },
            created_at: '2024-01-01T00:00:00Z',
          },
        ]),
      } as MockResult)
      // Only 1 detail call (for alice's issue), not 2
      .mockResolvedValueOnce({
        failed: false,
        stdout: JSON.stringify({
          title: 'Human issue',
          description: 'Details',
          state: 'opened',
          author: { username: 'alice' },
          labels: [],
          assignees: [],
          web_url: 'https://gitlab.com/group/project/-/issues/100',
        }),
      } as MockResult);

    const events = await botFetcher.fetchEvents(repo);
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe('alice');
    // launch called twice: events list + 1 issue detail (not 3 which would mean MR detail was also called)
    expect(mockLaunch).toHaveBeenCalledTimes(2);
  });
});
