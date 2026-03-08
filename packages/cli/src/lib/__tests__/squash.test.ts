import { describe, expect, it, vi } from 'vitest';
import { resolveTaskCollapseRef } from '../squash.js';

describe('resolveTaskCollapseRef', () => {
  it('prefers the remote branch when it exists', () => {
    const git = {
      getCommitHash: vi.fn((ref: string) =>
        ref === 'origin/task-1' ? 'abc123' : ''
      ),
    };

    expect(
      resolveTaskCollapseRef(
        git as any,
        '/tmp/worktree',
        'base-commit',
        'origin/task-1'
      )
    ).toBe('origin/task-1');
  });

  it('falls back to the base commit when the remote branch does not exist', () => {
    const git = {
      getCommitHash: vi.fn().mockReturnValue(''),
    };

    expect(
      resolveTaskCollapseRef(
        git as any,
        '/tmp/worktree',
        'base-commit',
        'origin/task-1'
      )
    ).toBe('base-commit');
  });
});
