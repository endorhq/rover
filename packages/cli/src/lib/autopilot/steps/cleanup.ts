import { execSync } from 'node:child_process';
import { processTerminalStep } from './terminal.js';
import type { PendingAction } from '../types.js';
import type {
  Step,
  StepConfig,
  StepDependencies,
  StepContext,
  StepResult,
} from './types.js';

export const cleanupStep: Step = {
  config: {
    actionType: 'cleanup',
    maxParallel: 3,
  } satisfies StepConfig,

  dependencies: {} satisfies StepDependencies,

  async process(pending: PendingAction, ctx: StepContext): Promise<StepResult> {
    const { store, projectPath } = ctx;

    const branch = pending.meta?.branch as string | undefined;
    const prNumber = pending.meta?.pr_number as number | undefined;
    const reason = pending.meta?.reason ?? 'unknown';

    return processTerminalStep(pending, ctx, {
      stepName: 'cleanup',
      buildSpanMeta: () => ({ branch, prNumber, reason }),
      hook: ({ span, chainSummary }) => {
        const cleaned: string[] = [];
        const errors: string[] = [];

        // Look up task mapping by matching branchName
        let taskMappingKey: string | undefined;
        if (branch) {
          const allMappings = store.getAllTaskMappings();
          for (const [key, mapping] of Object.entries(allMappings)) {
            if (mapping.branchName === branch) {
              taskMappingKey = key;
              break;
            }
          }
        }

        // Best-effort: remove git worktree
        if (branch) {
          try {
            execSync(`git worktree remove "${branch}" --force 2>/dev/null`, {
              cwd: projectPath,
              stdio: 'pipe',
            });
            cleaned.push(`worktree: ${branch}`);
          } catch {
            errors.push(
              `worktree removal skipped (not found or already removed)`
            );
          }

          // Best-effort: delete local branch
          try {
            execSync(`git branch -D "${branch}" 2>/dev/null`, {
              cwd: projectPath,
              stdio: 'pipe',
            });
            cleaned.push(`branch: ${branch}`);
          } catch {
            errors.push(
              `branch deletion skipped (not found or already deleted)`
            );
          }
        }

        // Remove task mapping from store
        if (taskMappingKey) {
          const state = store.loadState();
          if (state.taskMappings) {
            delete state.taskMappings[taskMappingKey];
            store.saveState(state);
            cleaned.push(`task mapping: ${taskMappingKey}`);
          }
        }

        const summary =
          cleaned.length > 0
            ? `cleanup (${reason}): removed ${cleaned.join(', ')}`
            : `cleanup (${reason}): nothing to remove`;

        // Finalize span with extra meta (cleaned/errors)
        span.complete(summary, { cleaned, errors });

        return {
          summary,
          reasoning: summary,
          memorySummary: `${summary}. ${chainSummary}`,
          spanFinalized: true,
        };
      },
    });
  },
};
