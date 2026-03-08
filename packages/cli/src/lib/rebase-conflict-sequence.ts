import colors from 'ansi-colors';
import type { AIAgentTool } from './agents/index.js';
import { isJsonMode } from './context.js';
import { showRoverChat } from '../utils/display.js';
import type { CLIJsonOutput } from '../output-types.js';
import type { Git } from 'rover-core';

export const resolveRebaseConflictSequence = async (
  git: Git,
  aiAgent: AIAgentTool,
  worktreePath: string,
  initialConflicts: string[],
  options: {
    concurrency: number;
    contextLines: number;
    sendFullFile: boolean;
    resolveConflicts: (
      git: Git,
      conflictedFiles: string[],
      aiAgent: AIAgentTool,
      worktreePath: string,
      concurrency: number,
      contextLines?: number,
      sendFullFile?: boolean
    ) => Promise<{ success: boolean; failureReason?: string }>;
    confirmContinue: (git: Git, worktreePath: string) => Promise<boolean>;
  },
  jsonOutput: CLIJsonOutput & { conflictsResolved?: boolean }
): Promise<{ success: boolean; error?: string }> => {
  let rebaseConflicts = initialConflicts;

  while (rebaseConflicts.length > 0) {
    if (!isJsonMode()) {
      console.log(
        colors.yellow(
          `\n⚠ Rebase conflicts detected in ${rebaseConflicts.length} file(s):`
        )
      );
      rebaseConflicts.forEach((file, index) => {
        const isLast = index === rebaseConflicts.length - 1;
        const connector = isLast ? '└──' : '├──';
        console.log(colors.gray(connector), file);
      });

      showRoverChat([
        'I noticed some rebase conflicts. I will try to solve them',
      ]);
    }

    const resolution = await options.resolveConflicts(
      git,
      rebaseConflicts,
      aiAgent,
      worktreePath,
      options.concurrency,
      options.contextLines,
      options.sendFullFile
    );

    if (!resolution.success) {
      git.abortRebase({ worktreePath });
      return {
        success: false,
        error:
          resolution.failureReason || 'AI failed to resolve rebase conflicts',
      };
    }

    jsonOutput.conflictsResolved = true;

    if (!(await options.confirmContinue(git, worktreePath))) {
      return {
        success: false,
        error: 'User rejected AI resolution. Rebase aborted',
      };
    }

    try {
      git.continueRebase({ worktreePath });
      return { success: true };
    } catch (continueError) {
      rebaseConflicts = git.getMergeConflicts({ worktreePath });
      if (rebaseConflicts.length === 0) {
        git.abortRebase({ worktreePath });
        return {
          success: false,
          error: `Error completing rebase after conflict resolution: ${continueError}`,
        };
      }
    }
  }

  return {
    success: false,
    error: 'Rebase is still in progress, but no conflicts were reported',
  };
};
