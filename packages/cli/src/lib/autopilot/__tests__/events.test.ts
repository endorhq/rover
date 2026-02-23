import { describe, it, expect, vi } from 'vitest';
import type { GitHubEvent } from '../types.js';
import { filterRelevantEvents } from '../events.js';
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
