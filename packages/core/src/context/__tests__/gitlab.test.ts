import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { GitLabProvider } from '../providers/gitlab.js';
import { ContextFetchError } from '../errors.js';
import type { IssueMetadata, PRMetadata } from '../types.js';

// Mock the os module
vi.mock('../../os.js', () => ({
  launchSync: vi.fn(),
}));

// Mock the git module
vi.mock('../../git.js', () => ({
  Git: vi.fn().mockImplementation(() => ({
    remoteUrl: vi.fn().mockReturnValue('git@gitlab.com:group/repo.git'),
  })),
}));

import { launchSync } from '../../os.js';
import { Git } from '../../git.js';

const mockLaunchSync = vi.mocked(launchSync);
const MockGit = vi.mocked(Git);

describe('GitLabProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: glab CLI is available
    mockLaunchSync.mockImplementation((cmd, args) => {
      if (cmd === 'glab' && args?.[0] === '--version') {
        return { exitCode: 0, stdout: 'glab version 1.30.0' } as ReturnType<
          typeof launchSync
        >;
      }
      return { exitCode: 1, stderr: 'Unknown command' } as ReturnType<
        typeof launchSync
      >;
    });
    // Default: GitLab remote
    MockGit.mockImplementation(
      () =>
        ({
          remoteUrl: vi.fn().mockReturnValue('git@gitlab.com:group/repo.git'),
        }) as any
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('URI Parsing', () => {
    it('should parse gitlab:issue/15 correctly', () => {
      const provider = new GitLabProvider(new URL('gitlab:issue/15'), {
        originalUri: 'gitlab:issue/15',
      });

      expect(provider.uri).toBe('gitlab:issue/15');
      expect(provider.scheme).toBe('gitlab');
      expect(provider.supportedTypes).toEqual(['issue', 'mr']);
    });

    it('should parse gitlab:mr/42 correctly', () => {
      const provider = new GitLabProvider(new URL('gitlab:mr/42'), {
        originalUri: 'gitlab:mr/42',
      });

      expect(provider.uri).toBe('gitlab:mr/42');
    });

    it('should parse gitlab:group/project/issue/15 correctly', () => {
      const provider = new GitLabProvider(
        new URL('gitlab:group/project/issue/15'),
        {
          originalUri: 'gitlab:group/project/issue/15',
        }
      );

      expect(provider.uri).toBe('gitlab:group/project/issue/15');
    });

    it('should parse gitlab:group/project/mr/42 correctly', () => {
      const provider = new GitLabProvider(
        new URL('gitlab:group/project/mr/42'),
        {
          originalUri: 'gitlab:group/project/mr/42',
        }
      );

      expect(provider.uri).toBe('gitlab:group/project/mr/42');
    });

    it('should throw ContextFetchError for invalid URI format', () => {
      expect(
        () =>
          new GitLabProvider(new URL('gitlab:invalid'), {
            originalUri: 'gitlab:invalid',
          })
      ).toThrow(ContextFetchError);
    });

    it('should throw ContextFetchError for missing number', () => {
      expect(
        () =>
          new GitLabProvider(new URL('gitlab:issue/'), {
            originalUri: 'gitlab:issue/',
          })
      ).toThrow(ContextFetchError);
    });
  });

  describe('isGlabCliAvailable', () => {
    it('should return true when glab CLI is available', () => {
      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0, stdout: 'glab version 1.30.0' } as ReturnType<
            typeof launchSync
          >;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      expect(GitLabProvider.isGlabCliAvailable()).toBe(true);
    });

    it('should return false when glab CLI is not available', () => {
      mockLaunchSync.mockImplementation(() => {
        return { exitCode: 1, stderr: 'command not found' } as ReturnType<
          typeof launchSync
        >;
      });

      expect(GitLabProvider.isGlabCliAvailable()).toBe(false);
    });
  });

  describe('Repository Resolution', () => {
    it('should use projectPath from URI when provided', async () => {
      const issueResponse = {
        iid: 15,
        title: 'Test Issue',
        description: 'Issue body',
        state: 'opened',
        labels: [],
        assignees: [],
        author: { username: 'testuser' },
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-20T15:30:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'issue' && args?.[1] === 'view') {
          // Verify correct repo is used
          expect(args).toContain('explicit/repo');
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(
        new URL('gitlab:explicit/repo/issue/15'),
        {
          originalUri: 'gitlab:explicit/repo/issue/15',
        }
      );

      const entries = await provider.build();

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('Issue #15: Test Issue');
    });

    it('should detect project from git remote when URI is short', async () => {
      const issueResponse = {
        iid: 15,
        title: 'Test Issue',
        description: 'Issue body',
        state: 'opened',
        labels: [],
        assignees: [],
        author: { username: 'testuser' },
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-20T15:30:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'issue' && args?.[1] === 'view') {
          // Verify correct repo is used (from git remote)
          expect(args).toContain('group/repo');
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:issue/15'), {
        originalUri: 'gitlab:issue/15',
      });

      const entries = await provider.build();

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('Issue #15: Test Issue');
    });

    it('should throw ContextFetchError when glab CLI is not available', async () => {
      mockLaunchSync.mockImplementation(() => {
        return { exitCode: 1, stderr: 'command not found' } as ReturnType<
          typeof launchSync
        >;
      });

      const provider = new GitLabProvider(new URL('gitlab:issue/15'), {
        originalUri: 'gitlab:issue/15',
      });

      await expect(provider.build()).rejects.toThrow(ContextFetchError);
    });
  });

  describe('build() - Issue', () => {
    it('should fetch and build issue context entry', async () => {
      const issueResponse = {
        iid: 15,
        title: 'Test Issue',
        description: 'Issue description',
        state: 'opened',
        labels: ['bug', 'enhancement'],
        assignees: [{ username: 'user1' }, { username: 'user2' }],
        milestone: { title: 'v1.0' },
        author: { username: 'author' },
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-20T15:30:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'issue' && args?.[1] === 'view') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:issue/15'), {
        originalUri: 'gitlab:issue/15',
      });

      const entries = await provider.build();

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('Issue #15: Test Issue');
      expect(entries[0].description).toBe('GitLab Issue #15 from group/repo');
      expect(entries[0].filename).toBe('gitlab-issue-15.md');
      expect(entries[0].source).toBe('gitlab:issue/15');
      expect(entries[0].content).toContain('# Issue #15: Test Issue');
      expect(entries[0].content).toContain('Issue description');

      const metadata = entries[0].metadata as IssueMetadata;
      expect(metadata.type).toBe('gitlab:issue');
      expect(metadata.number).toBe(15);
      expect(metadata.state).toBe('opened');
      expect(metadata.labels).toEqual(['bug', 'enhancement']);
      expect(metadata.assignees).toEqual(['user1', 'user2']);
      expect(metadata.milestone).toBe('v1.0');
      expect(metadata.author).toBe('author');

      // Verify glab command was called correctly
      expect(mockLaunchSync).toHaveBeenCalledWith(
        'glab',
        ['issue', 'view', '15', '--repo', 'group/repo', '--output', 'json'],
        { reject: false }
      );
    });

    it('should include notes when trustAllAuthors is true', async () => {
      const issueResponse = {
        iid: 15,
        title: 'Test Issue',
        description: 'Issue description',
        state: 'opened',
        labels: [],
        assignees: [],
        author: { username: 'author' },
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-20T15:30:00Z',
      };

      const notesResponse = [
        {
          author: { username: 'user1' },
          body: 'Comment 1',
          created_at: '2024-01-16T10:00:00Z',
        },
        {
          author: { username: 'user2' },
          body: 'Comment 2',
          created_at: '2024-01-17T10:00:00Z',
        },
      ];

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'issue' && args?.[1] === 'view') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'api') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(notesResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:issue/15'), {
        originalUri: 'gitlab:issue/15',
        trustAllAuthors: true,
      });

      const entries = await provider.build();

      expect(entries[0].content).toContain('## Comments');
      expect(entries[0].content).toContain('@user1');
      expect(entries[0].content).toContain('Comment 1');
      expect(entries[0].content).toContain('@user2');
      expect(entries[0].content).toContain('Comment 2');

      // Verify notes API was called
      expect(mockLaunchSync).toHaveBeenCalledWith(
        'glab',
        ['api', 'projects/group%2Frepo/issues/15/notes', '--output', 'json'],
        { reject: false }
      );
    });

    it('should filter notes based on trustedAuthors', async () => {
      const issueResponse = {
        iid: 15,
        title: 'Test Issue',
        description: 'Issue description',
        state: 'opened',
        labels: [],
        assignees: [],
        author: { username: 'author' },
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-20T15:30:00Z',
      };

      const notesResponse = [
        {
          author: { username: 'user1' },
          body: 'Comment 1',
          created_at: '2024-01-16T10:00:00Z',
        },
        {
          author: { username: 'user2' },
          body: 'Comment 2',
          created_at: '2024-01-17T10:00:00Z',
        },
      ];

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'issue' && args?.[1] === 'view') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'api') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(notesResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:issue/15'), {
        originalUri: 'gitlab:issue/15',
        trustAuthors: ['user1'],
      });

      const entries = await provider.build();

      expect(entries[0].content).toContain('## Comments');
      expect(entries[0].content).toContain('@user1');
      expect(entries[0].content).toContain('Comment 1');
      expect(entries[0].content).not.toContain('@user2');
      expect(entries[0].content).not.toContain('Comment 2');
    });

    it('should not include notes when no trust options are set', async () => {
      const issueResponse = {
        iid: 15,
        title: 'Test Issue',
        description: 'Issue description',
        state: 'opened',
        labels: [],
        assignees: [],
        author: { username: 'author' },
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-20T15:30:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'issue' && args?.[1] === 'view') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:issue/15'), {
        originalUri: 'gitlab:issue/15',
      });

      const entries = await provider.build();

      expect(entries[0].content).not.toContain('## Comments');
      // Verify notes API was NOT called
      const apiCalls = mockLaunchSync.mock.calls.filter(
        call => call[0] === 'glab' && call[1]?.[0] === 'api'
      );
      expect(apiCalls).toHaveLength(0);
    });

    it('should throw ContextFetchError when glab command fails', async () => {
      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'issue' && args?.[1] === 'view') {
          return {
            exitCode: 1,
            stderr: 'Issue #999 not found',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:issue/999'), {
        originalUri: 'gitlab:issue/999',
      });

      await expect(provider.build()).rejects.toThrow(ContextFetchError);
    });
  });

  describe('build() - MR', () => {
    it('should fetch and build MR context entry', async () => {
      const mrResponse = {
        iid: 42,
        title: 'Test MR',
        description: 'MR description',
        state: 'opened',
        source_branch: 'feature-branch',
        target_branch: 'main',
        work_in_progress: false,
        merge_status: 'can_be_merged',
        labels: ['feature'],
        assignees: [{ username: 'user1' }],
        reviewers: [{ username: 'reviewer1' }],
        author: { username: 'author' },
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-20T15:30:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'mr' && args?.[1] === 'view') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(mrResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:mr/42'), {
        originalUri: 'gitlab:mr/42',
      });

      const entries = await provider.build();

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('MR #42: Test MR');
      expect(entries[0].description).toBe('GitLab MR #42 from group/repo');
      expect(entries[0].filename).toBe('gitlab-mr-42.md');
      expect(entries[0].source).toBe('gitlab:mr/42');
      expect(entries[0].content).toContain('# MR #42: Test MR');
      expect(entries[0].content).toContain('MR description');
      expect(entries[0].content).toContain('feature-branch → main');

      const metadata = entries[0].metadata as PRMetadata;
      expect(metadata.type).toBe('gitlab:mr');
      expect(metadata.number).toBe(42);
      expect(metadata.state).toBe('opened');
      expect(metadata.headBranch).toBe('feature-branch');
      expect(metadata.baseBranch).toBe('main');
      expect(metadata.isDraft).toBe(false);
      expect(metadata.mergeable).toBe(true);
      expect(metadata.labels).toEqual(['feature']);
      expect(metadata.assignees).toEqual(['user1']);
      expect(metadata.reviewers).toEqual(['reviewer1']);
      expect(metadata.author).toBe('author');

      // Verify glab command was called correctly
      expect(mockLaunchSync).toHaveBeenCalledWith(
        'glab',
        ['mr', 'view', '42', '--repo', 'group/repo', '--output', 'json'],
        { reject: false }
      );
    });

    it('should handle self-hosted GitLab instance', async () => {
      MockGit.mockImplementation(
        () =>
          ({
            remoteUrl: vi
              .fn()
              .mockReturnValue('https://gitlab.example.com/group/repo.git'),
          }) as any
      );

      const mrResponse = {
        iid: 42,
        title: 'Test MR',
        description: 'MR description',
        state: 'opened',
        source_branch: 'feature',
        target_branch: 'main',
        work_in_progress: false,
        merge_status: 'can_be_merged',
        labels: [],
        assignees: [],
        reviewers: [],
        author: { username: 'author' },
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-20T15:30:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'mr' && args?.[1] === 'view') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(mrResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:mr/42'), {
        originalUri: 'gitlab:mr/42',
      });

      await provider.build();

      // Verify glab command was called with self-hosted project path
      expect(mockLaunchSync).toHaveBeenCalledWith(
        'glab',
        ['mr', 'view', '42', '--repo', 'group/repo', '--output', 'json'],
        { reject: false }
      );
    });

    it('should handle explicit project path in URI', async () => {
      const issueResponse = {
        iid: 15,
        title: 'Test Issue',
        description: 'Issue description',
        state: 'opened',
        labels: [],
        assignees: [],
        author: { username: 'author' },
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-20T15:30:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'issue' && args?.[1] === 'view') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(
        new URL('gitlab:explicit/group/issue/15'),
        {
          originalUri: 'gitlab:explicit/group/issue/15',
        }
      );

      await provider.build();

      // Verify glab command was called with explicit project path
      expect(mockLaunchSync).toHaveBeenCalledWith(
        'glab',
        ['issue', 'view', '15', '--repo', 'explicit/group', '--output', 'json'],
        { reject: false }
      );
    });
  });
});
