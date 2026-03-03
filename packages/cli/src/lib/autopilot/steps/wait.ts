import { processTerminalStep } from './terminal.js';
import type { PendingAction, WaitEntry } from '../types.js';
import type {
  Step,
  StepConfig,
  StepDependencies,
  StepContext,
  StepResult,
} from './types.js';

export const waitStep: Step = {
  config: {
    actionType: 'wait',
    maxParallel: 5,
  } satisfies StepConfig,

  dependencies: {} satisfies StepDependencies,

  async process(pending: PendingAction, ctx: StepContext): Promise<StepResult> {
    const { store } = ctx;

    const waitingFor = pending.meta?.waiting_for ?? 'unknown condition';
    const resumeAction = pending.meta?.resume_action ?? 'plan';
    const resumeMeta = pending.meta?.resume_meta ?? {};

    return processTerminalStep(pending, ctx, {
      stepName: 'wait',
      buildSpanMeta: () => ({ waitingFor, resumeAction, resumeMeta }),
      hook: ({ span, chainSummary }) => {
        // Build wait entry and add to queue
        const entry: WaitEntry = {
          traceId: pending.traceId,
          actionId: pending.actionId,
          spanId: span.id,
          waitingFor,
          resumeAction,
          resumeMeta,
          eventSummary: chainSummary,
          createdAt: new Date().toISOString(),
        };
        store.addWaitEntry(entry);

        return {
          summary: `wait: waiting for ${waitingFor}`,
          reasoning: `wait: ${waitingFor}`,
          memorySummary: `Waiting for ${waitingFor}. ${chainSummary}`,
        };
      },
    });
  },
};
