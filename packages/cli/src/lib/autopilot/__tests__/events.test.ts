import { describe, it, expect, vi } from 'vitest';
import type { GitHubEvent } from '../types.js';
import {
  filterRelevantEvents,
  resolveAllowedActors,
  filterByAllowedActors,
} from '../events.js';
import { ROVER_FOOTER_MARKER } from '../constants.js';

// Mock rover-core (launch + getDataDir)
vi.mock('rover-core', async importOriginal => {
  const actual = await importOriginal<typeof import('rover-core')>();
  return {
    ...actual,
    launch: vi.fn(),
    getDataDir: () => '/tmp/rover-test-data',
  };
});

// Mock React hooks used by useGitHubEvents
vi.mock('react', () => ({
  useState: vi.fn((init: any) => [init, vi.fn()]),
  useEffect: vi.fn(),
  useRef: vi.fn((init: any) => ({ current: init })),
  useCallback: vi.fn((fn: any) => fn),
}));

// Mock logging
vi.mock('../logging.js', () => ({
  SpanWriter: vi.fn().mockImplementation(() => ({
    id: 'mock-span',
    complete: vi.fn(),
  })),
  ActionWriter: vi.fn().mockImplementation(() => ({
    id: 'mock-action',
  })),
  enqueueAction: vi.fn(),
}));

// Mock helpers
vi.mock('../helpers.js', () => ({
  getRepoInfo: vi.fn(() => ({ owner: 'test', repo: 'test' })),
}));

function makeEvent(overrides: Partial<GitHubEvent> = {}): GitHubEvent {
  return {
    id: 'evt-1',
    type: 'IssueCommentEvent',
    actor: { login: 'someuser' },
    created_at: new Date().toISOString(),
    payload: {},
    ...overrides,
  };
}

describe('filterRelevantEvents — self-comment detection', () => {
  it('filters out IssueCommentEvent with Rover footer marker', () => {
    const events = [
      makeEvent({
        type: 'IssueCommentEvent',
        payload: {
          action: 'created',
          issue: { number: 1, title: 'Test', state: 'open' },
          comment: {
            id: 123,
            user: { login: 'rover-bot' },
            body: `Some message\n\n<details>\n${ROVER_FOOTER_MARKER}\n\nTrace: \`abc\` | Action: \`def\`\n\n</details>`,
          },
        },
      }),
    ];

    const result = filterRelevantEvents(events);
    expect(result).toHaveLength(0);
  });

  it('passes through IssueCommentEvent without Rover footer', () => {
    const events = [
      makeEvent({
        type: 'IssueCommentEvent',
        payload: {
          action: 'created',
          issue: { number: 1, title: 'Test', state: 'open' },
          comment: {
            id: 124,
            user: { login: 'human-user' },
            body: 'Please review the changes in this PR.',
          },
        },
      }),
    ];

    const result = filterRelevantEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe('new comment on #1');
  });

  it('filters out PullRequestReviewEvent with Rover footer marker', () => {
    const events = [
      makeEvent({
        type: 'PullRequestReviewEvent',
        payload: {
          action: 'submitted',
          pull_request: { number: 10, title: 'PR', state: 'open' },
          review: {
            user: { login: 'rover-bot' },
            state: 'COMMENTED',
            body: `Review body\n\n<details>\n${ROVER_FOOTER_MARKER}\n\nTrace: \`t1\` | Action: \`a1\`\n\n</details>`,
          },
        },
      }),
    ];

    const result = filterRelevantEvents(events);
    expect(result).toHaveLength(0);
  });

  it('passes through PullRequestReviewEvent without Rover footer', () => {
    const events = [
      makeEvent({
        type: 'PullRequestReviewEvent',
        payload: {
          action: 'submitted',
          pull_request: { number: 10, title: 'PR', state: 'open' },
          review: {
            user: { login: 'human-user' },
            state: 'APPROVED',
            body: 'LGTM!',
          },
        },
      }),
    ];

    const result = filterRelevantEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe('new review on PR #10');
  });

  it('filters out PullRequestReviewCommentEvent with Rover footer marker', () => {
    const events = [
      makeEvent({
        type: 'PullRequestReviewCommentEvent',
        payload: {
          action: 'created',
          pull_request: { number: 20, title: 'PR2', state: 'open' },
          comment: {
            id: 456,
            user: { login: 'rover-bot' },
            path: 'src/foo.ts',
            body: `Inline review comment\n\n<details>\n${ROVER_FOOTER_MARKER}\n\nTrace: \`t2\` | Action: \`a2\`\n\n</details>`,
          },
        },
      }),
    ];

    const result = filterRelevantEvents(events);
    expect(result).toHaveLength(0);
  });

  it('passes through PullRequestReviewCommentEvent without Rover footer', () => {
    const events = [
      makeEvent({
        type: 'PullRequestReviewCommentEvent',
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
    ];

    const result = filterRelevantEvents(events);
    expect(result).toHaveLength(1);
    expect(result[0].summary).toBe('new review comment on PR #20');
  });

  it('handles empty comment body gracefully', () => {
    const events = [
      makeEvent({
        type: 'IssueCommentEvent',
        payload: {
          action: 'created',
          issue: { number: 5, title: 'Test', state: 'open' },
          comment: {
            id: 789,
            user: { login: 'user' },
            body: '',
          },
        },
      }),
    ];

    const result = filterRelevantEvents(events);
    expect(result).toHaveLength(1);
  });

  it('handles null comment body gracefully', () => {
    const events = [
      makeEvent({
        type: 'IssueCommentEvent',
        payload: {
          action: 'created',
          issue: { number: 5, title: 'Test', state: 'open' },
          comment: {
            id: 790,
            user: { login: 'user' },
            body: null,
          },
        },
      }),
    ];

    const result = filterRelevantEvents(events);
    expect(result).toHaveLength(1);
  });
});

describe('resolveAllowedActors', () => {
  it('returns null for undefined allowEvents', () => {
    expect(resolveAllowedActors(undefined, ['alice'])).toBeNull();
  });

  it('returns null for "all"', () => {
    expect(resolveAllowedActors('all', ['alice'])).toBeNull();
  });

  it('returns maintainers set (lowercased) for "maintainers"', () => {
    const result = resolveAllowedActors('maintainers', ['Alice', 'BOB']);
    expect(result).toEqual(new Set(['alice', 'bob']));
  });

  it('returns empty set for "maintainers" with no maintainers list', () => {
    expect(resolveAllowedActors('maintainers', undefined)).toEqual(new Set());
  });

  it('returns empty set for "maintainers" with empty maintainers list', () => {
    expect(resolveAllowedActors('maintainers', [])).toEqual(new Set());
  });

  it('parses comma-separated usernames (lowercased, trimmed)', () => {
    const result = resolveAllowedActors('Alice, Bob , Charlie', undefined);
    expect(result).toEqual(new Set(['alice', 'bob', 'charlie']));
  });

  it('ignores empty segments in comma-separated values', () => {
    const result = resolveAllowedActors('alice,,bob,', undefined);
    expect(result).toEqual(new Set(['alice', 'bob']));
  });
});

describe('filterByAllowedActors', () => {
  it('passes everything through when allowedActors is null', () => {
    const events = [
      makeEvent({ id: '1', actor: { login: 'anyone' } }),
      makeEvent({ id: '2', actor: { login: 'someone' } }),
    ];
    const result = filterByAllowedActors(events, null);
    expect(result.allowed).toHaveLength(2);
    expect(result.filteredCount).toBe(0);
  });

  it('filters events by allowed actor set', () => {
    const events = [
      makeEvent({ id: '1', actor: { login: 'alice' } }),
      makeEvent({ id: '2', actor: { login: 'eve' } }),
      makeEvent({ id: '3', actor: { login: 'bob' } }),
    ];
    const allowed = new Set(['alice', 'bob']);
    const result = filterByAllowedActors(events, allowed);
    expect(result.allowed).toHaveLength(2);
    expect(result.allowed.map(e => e.actor.login)).toEqual(['alice', 'bob']);
    expect(result.filteredCount).toBe(1);
  });

  it('performs case-insensitive matching', () => {
    const events = [
      makeEvent({ id: '1', actor: { login: 'Alice' } }),
      makeEvent({ id: '2', actor: { login: 'BOB' } }),
    ];
    const allowed = new Set(['alice', 'bob']);
    const result = filterByAllowedActors(events, allowed);
    expect(result.allowed).toHaveLength(2);
    expect(result.filteredCount).toBe(0);
  });

  it('blocks all events when allowed set is empty', () => {
    const events = [
      makeEvent({ id: '1', actor: { login: 'alice' } }),
      makeEvent({ id: '2', actor: { login: 'bob' } }),
    ];
    const result = filterByAllowedActors(events, new Set());
    expect(result.allowed).toHaveLength(0);
    expect(result.filteredCount).toBe(2);
  });
});
