import { execSync } from 'node:child_process';
import { SpanWriter } from '../logging.js';
import { summarizeChain } from '../summarizer.js';
import { recordTraceCompletion } from '../memory/writer.js';
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
    const { store, projectId, projectPath } = ctx;

    const branch = pending.meta?.branch as string | undefined;
    const prNumber = pending.meta?.pr_number as number | undefined;
    const reason = pending.meta?.reason ?? 'unknown';
    const cleaned: string[] = [];
    const errors: string[] = [];

    // Retrieve the full span chain
    const spans = store.getSpanTrace(pending.spanId);

    // Summarize the chain
    const { summary: chainSummary, saveToMemory } = await summarizeChain(
      spans,
      ctx.trace,
      projectPath,
      ctx.maintainers
    );

    // Create the cleanup span
    const span = new SpanWriter(projectId, {
      step: 'cleanup',
      parentId: pending.spanId,
      originAction: pending.actionId,
      meta: { branch, prNumber, reason },
    });

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
        // Worktree may already be removed or not exist
        errors.push(`worktree removal skipped (not found or already removed)`);
      }

      // Best-effort: delete local branch
      try {
        execSync(`git branch -D "${branch}" 2>/dev/null`, {
          cwd: projectPath,
          stdio: 'pipe',
        });
        cleaned.push(`branch: ${branch}`);
      } catch {
        // Branch may already be deleted
        errors.push(`branch deletion skipped (not found or already deleted)`);
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

    span.complete(summary, { cleaned, errors });

    // Record trace completion in memory
    if (saveToMemory) {
      await recordTraceCompletion(ctx.memoryStore, ctx.trace, spans, store, {
        summary: `${summary}. ${chainSummary}`,
      });
    }

    // Remove the processed action
    store.removePending(pending.actionId);

    return {
      spanId: span.id,
      terminal: true,
      enqueuedActions: [],
      reasoning: summary,
    };
  },
};
