import { SpanWriter } from '../logging.js';
import { summarizeChain } from '../summarizer.js';
import type { PendingAction } from '../types.js';
import type {
  Step,
  StepConfig,
  StepDependencies,
  StepContext,
  StepResult,
} from './types.js';

export const noopStep: Step = {
  config: {
    actionType: 'noop',
    maxParallel: 5,
  } satisfies StepConfig,

  dependencies: {} satisfies StepDependencies,

  async process(pending: PendingAction, ctx: StepContext): Promise<StepResult> {
    const { store, projectId, projectPath } = ctx;

    // Retrieve the full span chain leading to this action
    const spans = store.getSpanTrace(pending.spanId);

    // Summarize the chain
    const chainSummary = await summarizeChain(spans, ctx.trace, projectPath);

    // Create and complete the noop span
    const span = new SpanWriter(projectId, {
      step: 'noop',
      parentId: pending.spanId,
      meta: { summary: chainSummary },
    });

    span.complete(`noop: ${chainSummary}`);

    // Remove the processed action
    store.removePending(pending.actionId);

    return {
      spanId: span.id,
      terminal: true,
      enqueuedActions: [],
      reasoning: `noop: ${chainSummary}`,
    };
  },
};
