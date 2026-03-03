import { processTerminalStep } from './terminal.js';
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
    return processTerminalStep(pending, ctx, {
      stepName: 'noop',
      buildSpanMeta: chainSummary => ({ summary: chainSummary }),
      hook: ({ chainSummary }) => ({
        summary: `noop: ${chainSummary}`,
        reasoning: `noop: ${chainSummary}`,
      }),
    });
  },
};
