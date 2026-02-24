import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { GitLabProvider } from '../providers/gitlab.js';
import { ContextFetchError } from '../errors.js';
import type { IssueMetadata, PRMetadata, PRDiffMetadata } from '../types.js';

// Mock the os module
vi.mock('../../os.js', () => ({
  launchSync: vi.fn(),
}));

// Mock the git module
vi.mock('../../git.js', () => ({
  Git: vi.fn().mockImplementation(() => ({
    remoteUrl: vi.fn().mockReturnValue('git@gitlab.com:owner/repo.git'),
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
        return { exitCode: 0, stdout: 'glab version 1.36.0' } as ReturnType<
          typeof launchSync
        >;
      }
      return { exitCode: 1, stderr: 'Unknown command' } as ReturnType<
        typeof launchSync
      >;
    });
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

    it('should parse gitlab:owner/repo/issue/15 correctly', () => {
      const provider = new GitLabProvider(
        new URL('gitlab:owner/repo/issue/15'),
        {
          originalUri: 'gitlab:owner/repo/issue/15',
        }
      );

      expect(provider.uri).toBe('gitlab:owner/repo/issue/15');
    });

    it('should parse gitlab:owner/repo/mr/42 correctly', () => {
      const provider = new GitLabProvider(new URL('gitlab:owner/repo/mr/42'), {
        originalUri: 'gitlab:owner/repo/mr/42',
      });

      expect(provider.uri).toBe('gitlab:owner/repo/mr/42');
    });

    it('should parse gitlab:group/subgroup/repo/issue/15 (nested groups)', () => {
      const provider = new GitLabProvider(
        new URL('gitlab:group/subgroup/repo/issue/15'),
        {
          originalUri: 'gitlab:group/subgroup/repo/issue/15',
        }
      );

      expect(provider.uri).toBe('gitlab:group/subgroup/repo/issue/15');
    });

    it('should parse gitlab:group/subgroup/repo/mr/42 (nested groups)', () => {
      const provider = new GitLabProvider(
        new URL('gitlab:group/subgroup/repo/mr/42'),
        {
          originalUri: 'gitlab:group/subgroup/repo/mr/42',
        }
      );

      expect(provider.uri).toBe('gitlab:group/subgroup/repo/mr/42');
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
          return {
            exitCode: 0,
            stdout: 'glab version 1.36.0',
          } as ReturnType<typeof launchSync>;
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
    it('should use project path from URI when provided', async () => {
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
        if (cmd === 'glab' && args?.[0] === 'api') {
          return {
            exitCode: 0,
            stdout: '[]',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(
        new URL('gitlab:explicit/repo/issue/15'),
        {
          originalUri: 'gitlab:explicit/repo/issue/15',
          trustAllAuthors: true,
        }
      );

      await provider.build();
    });

    it('should detect repo from git remote when not in URI', async () => {
      MockGit.mockImplementation(
        () =>
          ({
            remoteUrl: vi.fn().mockReturnValue('git@gitlab.com:owner/repo.git'),
          }) as unknown as Git
      );

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
          expect(args).toContain('owner/repo');
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'api') {
          return {
            exitCode: 0,
            stdout: '[]',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:issue/15'), {
        originalUri: 'gitlab:issue/15',
        trustAllAuthors: true,
      });

      await provider.build();
    });

    it('should parse HTTPS remote URL correctly', async () => {
      MockGit.mockImplementation(
        () =>
          ({
            remoteUrl: vi
              .fn()
              .mockReturnValue('https://gitlab.com/https-owner/https-repo.git'),
          }) as unknown as Git
      );

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
          expect(args).toContain('https-owner/https-repo');
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'api') {
          return {
            exitCode: 0,
            stdout: '[]',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:issue/15'), {
        originalUri: 'gitlab:issue/15',
        trustAllAuthors: true,
      });

      await provider.build();
    });

    it('should parse SSH remote URL with nested groups', async () => {
      MockGit.mockImplementation(
        () =>
          ({
            remoteUrl: vi
              .fn()
              .mockReturnValue('git@gitlab.com:group/subgroup/repo.git'),
          }) as unknown as Git
      );

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
          expect(args).toContain('group/subgroup/repo');
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'api') {
          return {
            exitCode: 0,
            stdout: '[]',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:issue/15'), {
        originalUri: 'gitlab:issue/15',
        trustAllAuthors: true,
      });

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
    });

    it('should parse HTTPS remote URL with nested groups', async () => {
      MockGit.mockImplementation(
        () =>
          ({
            remoteUrl: vi
              .fn()
              .mockReturnValue('https://gitlab.com/group/subgroup/repo.git'),
          }) as unknown as Git
      );

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
          expect(args).toContain('group/subgroup/repo');
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'api') {
          return {
            exitCode: 0,
            stdout: '[]',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:issue/15'), {
        originalUri: 'gitlab:issue/15',
        trustAllAuthors: true,
      });

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
    });

    it('should throw when no remote is found', async () => {
      MockGit.mockImplementation(
        () =>
          ({
            remoteUrl: vi.fn().mockReturnValue(''),
          }) as unknown as Git
      );

      const provider = new GitLabProvider(new URL('gitlab:issue/15'), {
        originalUri: 'gitlab:issue/15',
      });

      await expect(provider.build()).rejects.toThrow(ContextFetchError);
      await expect(provider.build()).rejects.toThrow('No git remote found');
    });

    it('should support self-hosted GitLab instances', async () => {
      MockGit.mockImplementation(
        () =>
          ({
            remoteUrl: vi
              .fn()
              .mockReturnValue('git@gitlab.mycompany.com:team/project.git'),
          }) as unknown as Git
      );

      const issueResponse = {
        iid: 42,
        title: 'Enterprise Issue',
        description: 'Issue body',
        state: 'opened',
        labels: [],
        assignees: [],
        author: { username: 'employee' },
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-20T15:30:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'issue' && args?.[1] === 'view') {
          expect(args).toContain('team/project');
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'api') {
          return {
            exitCode: 0,
            stdout: '[]',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:issue/42'), {
        originalUri: 'gitlab:issue/42',
        trustAllAuthors: true,
      });

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('Issue #42: Enterprise Issue');
    });
  });

  describe('Issue Building', () => {
    const issueResponse = {
      iid: 15,
      title: 'Bug: Something broken',
      description:
        'This is the issue description.\n\nWith multiple paragraphs.',
      state: 'opened',
      labels: ['bug', 'priority::high'],
      assignees: [{ username: 'alice' }, { username: 'bob' }],
      milestone: { title: 'v2.1' },
      author: { username: 'creator' },
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-20T15:30:00Z',
    };

    const notesResponse = [
      {
        author: { username: 'charlie' },
        body: 'I can reproduce this.',
        created_at: '2024-01-16T10:00:00Z',
        system: false,
      },
      {
        author: { username: 'system' },
        body: 'assigned to @alice',
        created_at: '2024-01-16T10:01:00Z',
        system: true,
      },
      {
        author: { username: 'untrusted' },
        body: 'Me too!',
        created_at: '2024-01-17T10:00:00Z',
        system: false,
      },
    ];

    beforeEach(() => {
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
    });

    it('should return ContextEntry with formatted markdown content', async () => {
      const provider = new GitLabProvider(
        new URL('gitlab:owner/repo/issue/15'),
        {
          originalUri: 'gitlab:owner/repo/issue/15',
          trustAllAuthors: true,
        }
      );

      const entries = await provider.build();

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('Issue #15: Bug: Something broken');
      expect(entries[0].description).toContain('owner/repo');
      expect(entries[0].filename).toBe('gitlab-issue-15.md');
      expect(entries[0].fetchedAt).toBeInstanceOf(Date);

      // Check content formatting
      expect(entries[0].content).toContain(
        '# Issue #15: Bug: Something broken'
      );
      expect(entries[0].content).toContain('**State:** opened');
      expect(entries[0].content).toContain('**Labels:** bug, priority::high');
      expect(entries[0].content).toContain('**Assignees:** @alice, @bob');
      expect(entries[0].content).toContain('**Milestone:** v2.1');
      expect(entries[0].content).toContain('## Description');
      expect(entries[0].content).toContain('This is the issue description.');
      expect(entries[0].content).toContain('## Comments');
      expect(entries[0].content).toContain('@charlie');
    });

    it('should include metadata with state, labels, assignees', async () => {
      const provider = new GitLabProvider(
        new URL('gitlab:owner/repo/issue/15'),
        {
          originalUri: 'gitlab:owner/repo/issue/15',
          trustAllAuthors: true,
        }
      );

      const entries = await provider.build();
      const metadata = entries[0].metadata as IssueMetadata;

      expect(metadata.type).toBe('gitlab:issue');
      expect(metadata.number).toBe(15);
      expect(metadata.state).toBe('opened');
      expect(metadata.labels).toEqual(['bug', 'priority::high']);
      expect(metadata.assignees).toEqual(['alice', 'bob']);
      expect(metadata.milestone).toBe('v2.1');
      expect(metadata.author).toBe('creator');
      expect(metadata.createdAt).toBe('2024-01-15T10:00:00Z');
      expect(metadata.updatedAt).toBe('2024-01-20T15:30:00Z');
    });

    it('should filter out system-generated notes', async () => {
      const provider = new GitLabProvider(
        new URL('gitlab:owner/repo/issue/15'),
        {
          originalUri: 'gitlab:owner/repo/issue/15',
          trustAllAuthors: true,
        }
      );

      const entries = await provider.build();

      // System note "assigned to @alice" should not appear
      expect(entries[0].content).not.toContain('assigned to @alice');
      // User notes should appear
      expect(entries[0].content).toContain('@charlie');
      expect(entries[0].content).toContain('I can reproduce this.');
    });

    it('should filter comments based on trustAuthors', async () => {
      const provider = new GitLabProvider(
        new URL('gitlab:owner/repo/issue/15'),
        {
          originalUri: 'gitlab:owner/repo/issue/15',
          trustAuthors: ['charlie'],
        }
      );

      const entries = await provider.build();

      expect(entries[0].content).toContain('@charlie');
      expect(entries[0].content).not.toContain('@untrusted');
    });

    it('should exclude all comments when no trustAuthors specified', async () => {
      const provider = new GitLabProvider(
        new URL('gitlab:owner/repo/issue/15'),
        {
          originalUri: 'gitlab:owner/repo/issue/15',
        }
      );

      const entries = await provider.build();

      expect(entries[0].content).not.toContain('## Comments');
    });

    it('should handle empty/missing optional fields', async () => {
      const minimalIssue = {
        iid: 1,
        title: 'Minimal Issue',
        description: '',
        state: 'closed',
        labels: [],
        assignees: [],
        author: { username: 'author' },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'issue') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(minimalIssue),
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'api') {
          return {
            exitCode: 0,
            stdout: '[]',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(
        new URL('gitlab:owner/repo/issue/1'),
        {
          originalUri: 'gitlab:owner/repo/issue/1',
          trustAllAuthors: true,
        }
      );

      const entries = await provider.build();

      expect(entries[0].content).toContain('_No content provided._');
      expect(entries[0].content).not.toContain('**Labels:**');
      expect(entries[0].content).not.toContain('**Assignees:**');
      expect(entries[0].content).not.toContain('**Milestone:**');
      expect(entries[0].content).not.toContain('## Comments');

      const metadata = entries[0].metadata as IssueMetadata;
      expect(metadata.milestone).toBeUndefined();
    });

    it('should handle null description', async () => {
      const nullDescIssue = {
        iid: 2,
        title: 'Null Description Issue',
        description: null,
        state: 'opened',
        labels: [],
        assignees: [],
        author: { username: 'author' },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'issue') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(nullDescIssue),
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'api') {
          return {
            exitCode: 0,
            stdout: '[]',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(
        new URL('gitlab:owner/repo/issue/2'),
        {
          originalUri: 'gitlab:owner/repo/issue/2',
          trustAllAuthors: true,
        }
      );

      const entries = await provider.build();
      expect(entries[0].content).toContain('_No content provided._');
    });
  });

  describe('MR Building', () => {
    const mrResponse = {
      iid: 42,
      title: 'feat: Add new feature',
      description:
        'This MR adds a new feature.\n\n## Changes\n- Added X\n- Changed Y',
      state: 'opened',
      source_branch: 'feature/thing',
      target_branch: 'main',
      draft: false,
      merge_status: 'can_be_merged',
      labels: ['enhancement'],
      assignees: [{ username: 'alice' }],
      reviewers: [{ username: 'bob' }, { username: 'carol' }],
      author: { username: 'creator' },
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-20T15:30:00Z',
    };

    const mrNotesResponse = [
      {
        author: { username: 'bob' },
        body: 'Looks good!',
        created_at: '2024-01-16T10:00:00Z',
        system: false,
      },
      {
        author: { username: 'system' },
        body: 'approved this merge request',
        created_at: '2024-01-16T10:01:00Z',
        system: true,
      },
    ];

    const diffContent = `diff --git a/src/feature.ts b/src/feature.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/feature.ts
@@ -0,0 +1,5 @@
+export function newFeature() {
+  return 'new';
+}`;

    beforeEach(() => {
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
        if (cmd === 'glab' && args?.[0] === 'mr' && args?.[1] === 'diff') {
          return {
            exitCode: 0,
            stdout: diffContent,
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'api') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(mrNotesResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });
    });

    it('should return two ContextEntry objects (description + diff)', async () => {
      const provider = new GitLabProvider(new URL('gitlab:owner/repo/mr/42'), {
        originalUri: 'gitlab:owner/repo/mr/42',
        trustAllAuthors: true,
      });

      const entries = await provider.build();

      expect(entries).toHaveLength(2);
      expect(entries[0].filename).toBe('gitlab-mr-42.md');
      expect(entries[1].filename).toBe('gitlab-mr-42-diff.md');
    });

    it('should include MR metadata with branch info, reviewers', async () => {
      const provider = new GitLabProvider(new URL('gitlab:owner/repo/mr/42'), {
        originalUri: 'gitlab:owner/repo/mr/42',
        trustAllAuthors: true,
      });

      const entries = await provider.build();
      const metadata = entries[0].metadata as PRMetadata;

      expect(metadata.type).toBe('gitlab:mr');
      expect(metadata.number).toBe(42);
      expect(metadata.state).toBe('opened');
      expect(metadata.headBranch).toBe('feature/thing');
      expect(metadata.baseBranch).toBe('main');
      expect(metadata.isDraft).toBe(false);
      expect(metadata.mergeable).toBe(true);
      expect(metadata.labels).toEqual(['enhancement']);
      expect(metadata.assignees).toEqual(['alice']);
      expect(metadata.reviewers).toEqual(['bob', 'carol']);
      expect(metadata.author).toBe('creator');
    });

    it('should include diff content with metadata', async () => {
      const provider = new GitLabProvider(new URL('gitlab:owner/repo/mr/42'), {
        originalUri: 'gitlab:owner/repo/mr/42',
        trustAllAuthors: true,
      });

      const entries = await provider.build();
      const diffEntry = entries[1];
      const diffMetadata = diffEntry.metadata as PRDiffMetadata;

      expect(diffMetadata.type).toBe('gitlab:mr-diff');
      expect(diffMetadata.number).toBe(42);
      expect(diffMetadata.headBranch).toBe('feature/thing');
      expect(diffMetadata.baseBranch).toBe('main');

      expect(diffEntry.content).toContain('```diff');
      expect(diffEntry.content).toContain('export function newFeature()');
    });

    it('should format MR content with comments', async () => {
      const provider = new GitLabProvider(new URL('gitlab:owner/repo/mr/42'), {
        originalUri: 'gitlab:owner/repo/mr/42',
        trustAllAuthors: true,
      });

      const entries = await provider.build();
      const content = entries[0].content!;

      expect(content).toContain('# MR !42: feat: Add new feature');
      expect(content).toContain('**State:** opened');
      expect(content).toContain('**Branch:** feature/thing');
      expect(content).toContain('**Draft:** No');
      expect(content).toContain('**Reviewers:** @bob, @carol');
      expect(content).toContain('## Comments');
      expect(content).toContain('@bob');
      expect(content).toContain('Looks good!');
      // System note should not appear
      expect(content).not.toContain('approved this merge request');
    });

    it('should filter comments based on trustAuthors', async () => {
      const provider = new GitLabProvider(new URL('gitlab:owner/repo/mr/42'), {
        originalUri: 'gitlab:owner/repo/mr/42',
        trustAuthors: ['bob'],
      });

      const entries = await provider.build();
      const content = entries[0].content!;

      expect(content).toContain('## Comments');
      expect(content).toContain('@bob');
      expect(content).toContain('Looks good!');
    });

    it('should handle draft MRs', async () => {
      const draftMR = { ...mrResponse, draft: true };
      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'mr' && args?.[1] === 'view') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(draftMR),
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'mr' && args?.[1] === 'diff') {
          return { exitCode: 0, stdout: '' } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'api') {
          return {
            exitCode: 0,
            stdout: '[]',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:owner/repo/mr/42'), {
        originalUri: 'gitlab:owner/repo/mr/42',
        trustAllAuthors: true,
      });

      const entries = await provider.build();
      const metadata = entries[0].metadata as PRMetadata;

      expect(metadata.isDraft).toBe(true);
      expect(entries[0].content).toContain('**Draft:** Yes');
    });

    it('should handle merged MRs', async () => {
      const mergedMR = {
        ...mrResponse,
        state: 'merged',
        merged_at: '2024-01-25T10:00:00Z',
        merged_by: { username: 'merger' },
      };
      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'mr' && args?.[1] === 'view') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(mergedMR),
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'mr' && args?.[1] === 'diff') {
          return { exitCode: 0, stdout: '' } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'api') {
          return {
            exitCode: 0,
            stdout: '[]',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:owner/repo/mr/42'), {
        originalUri: 'gitlab:owner/repo/mr/42',
        trustAllAuthors: true,
      });

      const entries = await provider.build();
      const metadata = entries[0].metadata as PRMetadata;

      expect(metadata.mergedAt).toBe('2024-01-25T10:00:00Z');
      expect(metadata.mergedBy).toBe('merger');
    });

    it('should handle MR with non-mergeable status', async () => {
      const nonMergeableMR = {
        ...mrResponse,
        merge_status: 'cannot_be_merged',
      };
      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'mr' && args?.[1] === 'view') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(nonMergeableMR),
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'mr' && args?.[1] === 'diff') {
          return { exitCode: 0, stdout: '' } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'api') {
          return {
            exitCode: 0,
            stdout: '[]',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:owner/repo/mr/42'), {
        originalUri: 'gitlab:owner/repo/mr/42',
        trustAllAuthors: true,
      });

      const entries = await provider.build();
      const metadata = entries[0].metadata as PRMetadata;

      expect(metadata.mergeable).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    it('should throw when glab CLI is not available', async () => {
      mockLaunchSync.mockImplementation(() => {
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(
        new URL('gitlab:owner/repo/issue/15'),
        {
          originalUri: 'gitlab:owner/repo/issue/15',
        }
      );

      await expect(provider.build()).rejects.toThrow(ContextFetchError);
      await expect(provider.build()).rejects.toThrow('GitLab CLI (glab)');
    });

    it('should throw for non-existent issue', async () => {
      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'issue') {
          return {
            exitCode: 1,
            stderr:
              'GET https://gitlab.com/api/v4/projects/owner%2Frepo/issues/999: 404 Not Found',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(
        new URL('gitlab:owner/repo/issue/999'),
        {
          originalUri: 'gitlab:owner/repo/issue/999',
        }
      );

      await expect(provider.build()).rejects.toThrow(ContextFetchError);
      await expect(provider.build()).rejects.toThrow('Failed to fetch issue');
    });

    it('should throw for non-existent MR', async () => {
      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'glab' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'mr' && args?.[1] === 'view') {
          return {
            exitCode: 1,
            stderr:
              'GET https://gitlab.com/api/v4/projects/owner%2Frepo/merge_requests/999: 404 Not Found',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(new URL('gitlab:owner/repo/mr/999'), {
        originalUri: 'gitlab:owner/repo/mr/999',
      });

      await expect(provider.build()).rejects.toThrow(ContextFetchError);
      await expect(provider.build()).rejects.toThrow('Failed to fetch MR');
    });

    it('should gracefully handle notes API failure', async () => {
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
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'glab' && args?.[0] === 'api') {
          // API call fails
          return {
            exitCode: 1,
            stderr: 'API error',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitLabProvider(
        new URL('gitlab:owner/repo/issue/15'),
        {
          originalUri: 'gitlab:owner/repo/issue/15',
          trustAllAuthors: true,
        }
      );

      // Should not throw - notes failure is graceful
      const entries = await provider.build();
      expect(entries).toHaveLength(1);
      expect(entries[0].content).not.toContain('## Comments');
    });
  });
});
