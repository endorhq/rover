import { describe, it, expect, vi } from 'vitest';
import { resolveRebaseConflictSequence } from '../../lib/rebase-conflict-sequence.js';

vi.mock('../../lib/context.js', () => ({
  isJsonMode: vi.fn().mockReturnValue(true),
  setJsonMode: vi.fn(),
  requireProjectContext: vi.fn(),
}));

describe('resolveRebaseConflictSequence', () => {
  it('continues resolving conflicts until rebase completes', async () => {
    const git = {
      continueRebase: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('second conflict stop');
        })
        .mockImplementationOnce(() => undefined),
      getMergeConflicts: vi
        .fn()
        .mockReturnValueOnce(['second.ts'])
        .mockReturnValueOnce([]),
      abortRebase: vi.fn(),
    };

    const resolveConflicts = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: true });

    const confirmContinue = vi.fn().mockResolvedValue(true);
    const jsonOutput: { success: boolean; conflictsResolved?: boolean } = {
      success: false,
    };

    const result = await resolveRebaseConflictSequence(
      git as any,
      {} as any,
      '/tmp/worktree',
      ['first.ts'],
      {
        concurrency: 1,
        contextLines: 20,
        sendFullFile: false,
        resolveConflicts,
        confirmContinue,
      },
      jsonOutput
    );

    expect(result).toEqual({ success: true });
    expect(resolveConflicts).toHaveBeenCalledTimes(2);
    expect(git.continueRebase).toHaveBeenCalledTimes(2);
    expect(git.abortRebase).not.toHaveBeenCalled();
    expect(jsonOutput.conflictsResolved).toBe(true);
  });
});
