import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { GitHubProvider } from '../providers/github.js';
import { ContextFetchError } from '../errors.js';
import type { IssueMetadata, PRMetadata, PRDiffMetadata } from '../types.js';

// Mock the os module
vi.mock('../../os.js', () => ({
  launchSync: vi.fn(),
}));

// Mock the git module
vi.mock('../../git.js', () => ({
  Git: vi.fn().mockImplementation(() => ({
    remoteUrl: vi.fn().mockReturnValue('git@github.com:owner/repo.git'),
  })),
}));

import { launchSync } from '../../os.js';
import { Git } from '../../git.js';

const mockLaunchSync = vi.mocked(launchSync);
const MockGit = vi.mocked(Git);

describe('GitHubProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: gh CLI is available
    mockLaunchSync.mockImplementation((cmd, args) => {
      if (cmd === 'gh' && args?.[0] === '--version') {
        return { exitCode: 0, stdout: 'gh version 2.40.0' } as ReturnType<
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
    it('should parse github:issue/15 correctly', () => {
      const provider = new GitHubProvider(new URL('github:issue/15'), {
        originalUri: 'github:issue/15',
      });

      expect(provider.uri).toBe('github:issue/15');
      expect(provider.scheme).toBe('github');
      expect(provider.supportedTypes).toEqual(['issue', 'pr']);
    });

    it('should parse github:pr/42 correctly', () => {
      const provider = new GitHubProvider(new URL('github:pr/42'), {
        originalUri: 'github:pr/42',
      });

      expect(provider.uri).toBe('github:pr/42');
    });

    it('should parse github:owner/repo/issue/15 correctly', () => {
      const provider = new GitHubProvider(
        new URL('github:owner/repo/issue/15'),
        {
          originalUri: 'github:owner/repo/issue/15',
        }
      );

      expect(provider.uri).toBe('github:owner/repo/issue/15');
    });

    it('should parse github:owner/repo/pr/42 correctly', () => {
      const provider = new GitHubProvider(new URL('github:owner/repo/pr/42'), {
        originalUri: 'github:owner/repo/pr/42',
      });

      expect(provider.uri).toBe('github:owner/repo/pr/42');
    });

    it('should throw ContextFetchError for invalid URI format', async () => {
      expect(
        () =>
          new GitHubProvider(new URL('github:invalid'), {
            originalUri: 'github:invalid',
          })
      ).toThrow(ContextFetchError);
    });

    it('should throw ContextFetchError for missing number', async () => {
      expect(
        () =>
          new GitHubProvider(new URL('github:issue/'), {
            originalUri: 'github:issue/',
          })
      ).toThrow(ContextFetchError);
    });
  });

  describe('isGhCliAvailable', () => {
    it('should return true when gh CLI is available', () => {
      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'gh' && args?.[0] === '--version') {
          return { exitCode: 0, stdout: 'gh version 2.40.0' } as ReturnType<
            typeof launchSync
          >;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      expect(GitHubProvider.isGhCliAvailable()).toBe(true);
    });

    it('should return false when gh CLI is not available', () => {
      mockLaunchSync.mockImplementation(() => {
        return { exitCode: 1, stderr: 'command not found' } as ReturnType<
          typeof launchSync
        >;
      });

      expect(GitHubProvider.isGhCliAvailable()).toBe(false);
    });
  });

  describe('Repository Resolution', () => {
    it('should use owner/repo from URI when provided', async () => {
      const issueResponse = {
        number: 15,
        title: 'Test Issue',
        body: 'Issue body',
        state: 'open',
        labels: [],
        assignees: [],
        author: { login: 'testuser' },
        comments: [],
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-20T15:30:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'gh' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'gh' && args?.[0] === 'issue' && args?.[1] === 'view') {
          // Verify correct repo is used
          expect(args).toContain('explicit/repo');
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitHubProvider(
        new URL('github:explicit/repo/issue/15'),
        {
          originalUri: 'github:explicit/repo/issue/15',
          trustAllAuthors: true,
        }
      );

      await provider.build();
    });

    it('should detect repo from git remote when not in URI', async () => {
      MockGit.mockImplementation(
        () =>
          ({
            remoteUrl: vi.fn().mockReturnValue('git@github.com:owner/repo.git'),
          }) as unknown as Git
      );

      const issueResponse = {
        number: 15,
        title: 'Test Issue',
        body: 'Issue body',
        state: 'open',
        labels: [],
        assignees: [],
        author: { login: 'testuser' },
        comments: [],
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-20T15:30:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'gh' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'gh' && args?.[0] === 'issue' && args?.[1] === 'view') {
          expect(args).toContain('owner/repo');
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitHubProvider(new URL('github:issue/15'), {
        originalUri: 'github:issue/15',
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
              .mockReturnValue('https://github.com/https-owner/https-repo.git'),
          }) as unknown as Git
      );

      const issueResponse = {
        number: 15,
        title: 'Test Issue',
        body: 'Issue body',
        state: 'open',
        labels: [],
        assignees: [],
        author: { login: 'testuser' },
        comments: [],
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-20T15:30:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'gh' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'gh' && args?.[0] === 'issue' && args?.[1] === 'view') {
          expect(args).toContain('https-owner/https-repo');
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitHubProvider(new URL('github:issue/15'), {
        originalUri: 'github:issue/15',
        trustAllAuthors: true,
      });

      await provider.build();
    });

    it('should throw when no remote is found', async () => {
      MockGit.mockImplementation(
        () =>
          ({
            remoteUrl: vi.fn().mockReturnValue(''),
          }) as unknown as Git
      );

      const provider = new GitHubProvider(new URL('github:issue/15'), {
        originalUri: 'github:issue/15',
      });

      await expect(provider.build()).rejects.toThrow(ContextFetchError);
      await expect(provider.build()).rejects.toThrow('No git remote found');
    });

    it('should accept any git remote URL (user declared github: intent)', async () => {
      // The github: URI scheme declares user intent - we accept any remote format
      // and let the gh CLI validate if it's actually a GitHub repo
      MockGit.mockImplementation(
        () =>
          ({
            remoteUrl: vi.fn().mockReturnValue('git@gitlab.com:owner/repo.git'),
          }) as unknown as Git
      );

      const issueResponse = {
        number: 15,
        title: 'Test Issue',
        body: 'Issue body',
        state: 'open',
        labels: [],
        assignees: [],
        author: { login: 'testuser' },
        comments: [],
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-20T15:30:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'gh' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'gh' && args?.[0] === 'issue' && args?.[1] === 'view') {
          // Verify we extracted owner/repo from the "gitlab" URL
          expect(args).toContain('owner/repo');
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitHubProvider(new URL('github:issue/15'), {
        originalUri: 'github:issue/15',
        trustAllAuthors: true,
      });

      // Should succeed - we trust the user's github: declaration
      const entries = await provider.build();
      expect(entries).toHaveLength(1);
    });

    it('should support SSH aliases for multiple accounts', async () => {
      MockGit.mockImplementation(
        () =>
          ({
            remoteUrl: vi
              .fn()
              .mockReturnValue('git@github-personal:myorg/myrepo.git'),
          }) as unknown as Git
      );

      const issueResponse = {
        number: 15,
        title: 'Test Issue',
        body: 'Issue body',
        state: 'open',
        labels: [],
        assignees: [],
        author: { login: 'testuser' },
        comments: [],
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-20T15:30:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'gh' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'gh' && args?.[0] === 'issue' && args?.[1] === 'view') {
          expect(args).toContain('myorg/myrepo');
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitHubProvider(new URL('github:issue/15'), {
        originalUri: 'github:issue/15',
        trustAllAuthors: true,
      });

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
    });

    it('should support GitHub Enterprise URLs', async () => {
      MockGit.mockImplementation(
        () =>
          ({
            remoteUrl: vi
              .fn()
              .mockReturnValue('git@git.mycompany.com:team/project.git'),
          }) as unknown as Git
      );

      const issueResponse = {
        number: 42,
        title: 'Enterprise Issue',
        body: 'Issue body',
        state: 'open',
        labels: [],
        assignees: [],
        author: { login: 'employee' },
        comments: [],
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-20T15:30:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'gh' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'gh' && args?.[0] === 'issue' && args?.[1] === 'view') {
          expect(args).toContain('team/project');
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitHubProvider(new URL('github:issue/42'), {
        originalUri: 'github:issue/42',
        trustAllAuthors: true,
      });

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('Issue #42: Enterprise Issue');
    });
  });

  describe('Issue Building', () => {
    const issueResponse = {
      number: 15,
      title: 'Bug: Something broken',
      body: 'This is the issue description.\n\nWith multiple paragraphs.',
      state: 'open',
      labels: [{ name: 'bug' }, { name: 'priority:high' }],
      assignees: [{ login: 'alice' }, { login: 'bob' }],
      milestone: { title: 'v2.1' },
      author: { login: 'creator' },
      comments: [
        {
          author: { login: 'charlie' },
          body: 'I can reproduce this.',
          createdAt: '2024-01-16T10:00:00Z',
        },
        {
          author: { login: 'untrusted' },
          body: 'Me too!',
          createdAt: '2024-01-17T10:00:00Z',
        },
      ],
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-20T15:30:00Z',
    };

    beforeEach(() => {
      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'gh' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'gh' && args?.[0] === 'issue' && args?.[1] === 'view') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(issueResponse),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });
    });

    it('should return ContextEntry with formatted markdown content', async () => {
      const provider = new GitHubProvider(
        new URL('github:owner/repo/issue/15'),
        {
          originalUri: 'github:owner/repo/issue/15',
          trustAllAuthors: true,
        }
      );

      const entries = await provider.build();

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('Issue #15: Bug: Something broken');
      expect(entries[0].description).toContain('owner/repo');
      expect(entries[0].filename).toBe('github-issue-15.md');
      expect(entries[0].fetchedAt).toBeInstanceOf(Date);

      // Check content formatting
      expect(entries[0].content).toContain(
        '# Issue #15: Bug: Something broken'
      );
      expect(entries[0].content).toContain('**State:** open');
      expect(entries[0].content).toContain('**Labels:** bug, priority:high');
      expect(entries[0].content).toContain('**Assignees:** @alice, @bob');
      expect(entries[0].content).toContain('**Milestone:** v2.1');
      expect(entries[0].content).toContain('## Description');
      expect(entries[0].content).toContain('This is the issue description.');
      expect(entries[0].content).toContain('## Comments');
      expect(entries[0].content).toContain('@charlie');
    });

    it('should include metadata with state, labels, assignees', async () => {
      const provider = new GitHubProvider(
        new URL('github:owner/repo/issue/15'),
        {
          originalUri: 'github:owner/repo/issue/15',
          trustAllAuthors: true,
        }
      );

      const entries = await provider.build();
      const metadata = entries[0].metadata as IssueMetadata;

      expect(metadata.type).toBe('github:issue');
      expect(metadata.number).toBe(15);
      expect(metadata.state).toBe('open');
      expect(metadata.labels).toEqual(['bug', 'priority:high']);
      expect(metadata.assignees).toEqual(['alice', 'bob']);
      expect(metadata.milestone).toBe('v2.1');
      expect(metadata.author).toBe('creator');
      expect(metadata.createdAt).toBe('2024-01-15T10:00:00Z');
      expect(metadata.updatedAt).toBe('2024-01-20T15:30:00Z');
    });

    it('should filter comments based on trustAuthors', async () => {
      const provider = new GitHubProvider(
        new URL('github:owner/repo/issue/15'),
        {
          originalUri: 'github:owner/repo/issue/15',
          trustAuthors: ['charlie'],
        }
      );

      const entries = await provider.build();

      expect(entries[0].content).toContain('@charlie');
      expect(entries[0].content).not.toContain('@untrusted');
    });

    it('should exclude all comments when no trustAuthors specified', async () => {
      const provider = new GitHubProvider(
        new URL('github:owner/repo/issue/15'),
        {
          originalUri: 'github:owner/repo/issue/15',
        }
      );

      const entries = await provider.build();

      expect(entries[0].content).not.toContain('## Comments');
    });

    it('should handle empty/missing optional fields', async () => {
      const minimalIssue = {
        number: 1,
        title: 'Minimal Issue',
        body: '',
        state: 'closed',
        labels: [],
        assignees: [],
        author: { login: 'author' },
        comments: [],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'gh' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'gh' && args?.[0] === 'issue') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(minimalIssue),
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitHubProvider(
        new URL('github:owner/repo/issue/1'),
        {
          originalUri: 'github:owner/repo/issue/1',
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
  });

  describe('PR Building', () => {
    const prResponse = {
      number: 42,
      title: 'feat: Add new feature',
      body: 'This PR adds a new feature.\n\n## Changes\n- Added X\n- Changed Y',
      state: 'open',
      headRefName: 'feature/thing',
      baseRefName: 'main',
      isDraft: false,
      mergeable: 'MERGEABLE',
      labels: [{ name: 'enhancement' }],
      assignees: [{ login: 'alice' }],
      reviewRequests: [{ login: 'bob' }],
      author: { login: 'creator' },
      comments: [
        {
          author: { login: 'charlie' },
          body: 'Looks good!',
          createdAt: '2024-01-15T12:00:00Z',
        },
      ],
      reviews: [
        {
          author: { login: 'alice' },
          body: 'LGTM!',
          state: 'APPROVED',
          submittedAt: '2024-01-16T10:00:00Z',
        },
        {
          author: { login: 'bob' },
          body: 'Please fix the typo.',
          state: 'CHANGES_REQUESTED',
          submittedAt: '2024-01-16T11:00:00Z',
        },
      ],
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-20T15:30:00Z',
    };

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
        if (cmd === 'gh' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'gh' && args?.[0] === 'pr' && args?.[1] === 'view') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(prResponse),
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'gh' && args?.[0] === 'pr' && args?.[1] === 'diff') {
          return {
            exitCode: 0,
            stdout: diffContent,
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });
    });

    it('should return two ContextEntry objects (description + diff)', async () => {
      const provider = new GitHubProvider(new URL('github:owner/repo/pr/42'), {
        originalUri: 'github:owner/repo/pr/42',
        trustAllAuthors: true,
      });

      const entries = await provider.build();

      expect(entries).toHaveLength(2);
      expect(entries[0].filename).toBe('github-pr-42.md');
      expect(entries[1].filename).toBe('github-pr-42-diff.md');
    });

    it('should include PR metadata with branch info, reviewers', async () => {
      const provider = new GitHubProvider(new URL('github:owner/repo/pr/42'), {
        originalUri: 'github:owner/repo/pr/42',
        trustAllAuthors: true,
      });

      const entries = await provider.build();
      const metadata = entries[0].metadata as PRMetadata;

      expect(metadata.type).toBe('github:pr');
      expect(metadata.number).toBe(42);
      expect(metadata.state).toBe('open');
      expect(metadata.headBranch).toBe('feature/thing');
      expect(metadata.baseBranch).toBe('main');
      expect(metadata.isDraft).toBe(false);
      expect(metadata.mergeable).toBe(true);
      expect(metadata.labels).toEqual(['enhancement']);
      expect(metadata.assignees).toEqual(['alice']);
      expect(metadata.reviewers).toContain('bob');
      expect(metadata.reviewers).toContain('alice');
      expect(metadata.author).toBe('creator');
    });

    it('should include diff content with metadata', async () => {
      const provider = new GitHubProvider(new URL('github:owner/repo/pr/42'), {
        originalUri: 'github:owner/repo/pr/42',
        trustAllAuthors: true,
      });

      const entries = await provider.build();
      const diffEntry = entries[1];
      const diffMetadata = diffEntry.metadata as PRDiffMetadata;

      expect(diffMetadata.type).toBe('github:pr-diff');
      expect(diffMetadata.number).toBe(42);
      expect(diffMetadata.headBranch).toBe('feature/thing');
      expect(diffMetadata.baseBranch).toBe('main');

      expect(diffEntry.content).toContain('```diff');
      expect(diffEntry.content).toContain('export function newFeature()');
    });

    it('should format PR content with reviews and comments', async () => {
      const provider = new GitHubProvider(new URL('github:owner/repo/pr/42'), {
        originalUri: 'github:owner/repo/pr/42',
        trustAllAuthors: true,
      });

      const entries = await provider.build();
      const content = entries[0].content!;

      expect(content).toContain('# PR #42: feat: Add new feature');
      expect(content).toContain('**State:** open');
      expect(content).toContain('**Branch:** feature/thing');
      expect(content).toContain('**Draft:** No');
      expect(content).toContain('**Reviewers:**');
      expect(content).toContain('@alice (approved)');
      expect(content).toContain('@bob (changes_requested)');
      expect(content).toContain('## Reviews');
      expect(content).toContain('LGTM!');
      expect(content).toContain('## Comments');
      expect(content).toContain('@charlie');
    });

    it('should filter comments and reviews based on trustAuthors', async () => {
      const provider = new GitHubProvider(new URL('github:owner/repo/pr/42'), {
        originalUri: 'github:owner/repo/pr/42',
        trustAuthors: ['alice'],
      });

      const entries = await provider.build();
      const content = entries[0].content!;

      // Reviewers header line still shows all reviewers (not filtered)
      expect(content).toContain('**Reviewers:**');
      expect(content).toContain('@alice (approved)');

      // But only Alice's review content should be included in the Reviews section
      expect(content).toContain('## Reviews');
      expect(content).toContain('**@alice** (approved');
      expect(content).toContain('LGTM!');

      // Bob's review content should not be included
      expect(content).not.toContain('**@bob**');
      expect(content).not.toContain('Please fix the typo.');

      // Charlie's comment should not be included
      expect(content).not.toContain('**@charlie**');
      expect(content).not.toContain('Looks good!');
    });

    it('should handle draft PRs', async () => {
      const draftPR = { ...prResponse, isDraft: true };
      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'gh' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'gh' && args?.[0] === 'pr' && args?.[1] === 'view') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(draftPR),
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'gh' && args?.[0] === 'pr' && args?.[1] === 'diff') {
          return { exitCode: 0, stdout: '' } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitHubProvider(new URL('github:owner/repo/pr/42'), {
        originalUri: 'github:owner/repo/pr/42',
        trustAllAuthors: true,
      });

      const entries = await provider.build();
      const metadata = entries[0].metadata as PRMetadata;

      expect(metadata.isDraft).toBe(true);
      expect(entries[0].content).toContain('**Draft:** Yes');
    });

    it('should handle merged PRs', async () => {
      const mergedPR = {
        ...prResponse,
        state: 'MERGED',
        mergedAt: '2024-01-25T10:00:00Z',
        mergedBy: { login: 'merger' },
      };
      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'gh' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'gh' && args?.[0] === 'pr' && args?.[1] === 'view') {
          return {
            exitCode: 0,
            stdout: JSON.stringify(mergedPR),
          } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'gh' && args?.[0] === 'pr' && args?.[1] === 'diff') {
          return { exitCode: 0, stdout: '' } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitHubProvider(new URL('github:owner/repo/pr/42'), {
        originalUri: 'github:owner/repo/pr/42',
        trustAllAuthors: true,
      });

      const entries = await provider.build();
      const metadata = entries[0].metadata as PRMetadata;

      expect(metadata.mergedAt).toBe('2024-01-25T10:00:00Z');
      expect(metadata.mergedBy).toBe('merger');
    });
  });

  describe('Error Handling', () => {
    it('should throw when gh CLI is not available', async () => {
      mockLaunchSync.mockImplementation(() => {
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitHubProvider(
        new URL('github:owner/repo/issue/15'),
        {
          originalUri: 'github:owner/repo/issue/15',
        }
      );

      await expect(provider.build()).rejects.toThrow(ContextFetchError);
      await expect(provider.build()).rejects.toThrow('GitHub CLI (gh)');
    });

    it('should throw for non-existent issue', async () => {
      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'gh' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'gh' && args?.[0] === 'issue') {
          return {
            exitCode: 1,
            stderr:
              'GraphQL: Could not resolve to an Issue with the number of 999.',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitHubProvider(
        new URL('github:owner/repo/issue/999'),
        {
          originalUri: 'github:owner/repo/issue/999',
        }
      );

      await expect(provider.build()).rejects.toThrow(ContextFetchError);
      await expect(provider.build()).rejects.toThrow('Failed to fetch issue');
    });

    it('should throw for non-existent PR', async () => {
      mockLaunchSync.mockImplementation((cmd, args) => {
        if (cmd === 'gh' && args?.[0] === '--version') {
          return { exitCode: 0 } as ReturnType<typeof launchSync>;
        }
        if (cmd === 'gh' && args?.[0] === 'pr' && args?.[1] === 'view') {
          return {
            exitCode: 1,
            stderr:
              'GraphQL: Could not resolve to a PullRequest with the number of 999.',
          } as ReturnType<typeof launchSync>;
        }
        return { exitCode: 1 } as ReturnType<typeof launchSync>;
      });

      const provider = new GitHubProvider(new URL('github:owner/repo/pr/999'), {
        originalUri: 'github:owner/repo/pr/999',
      });

      await expect(provider.build()).rejects.toThrow(ContextFetchError);
      await expect(provider.build()).rejects.toThrow('Failed to fetch PR');
    });
  });
});
