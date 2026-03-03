import { SpanWriter } from '../logging.js';
import { summarizeChain } from '../summarizer.js';
import { recordTraceCompletion } from '../memory/writer.js';
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
    const { store, projectId, projectPath } = ctx;

    const waitingFor = pending.meta?.waiting_for ?? 'unknown condition';
    const resumeAction = pending.meta?.resume_action ?? 'plan';
    const resumeMeta = pending.meta?.resume_meta ?? {};

    // Retrieve the full span chain leading to this action
    const spans = store.getSpanTrace(pending.spanId);

    // Summarize the chain
    const { summary: chainSummary, saveToMemory } = await summarizeChain(
      spans,
      ctx.trace,
      projectPath,
      ctx.maintainers
    );

    // Create and complete the wait span
    const span = new SpanWriter(projectId, {
      step: 'wait',
      parentId: pending.spanId,
      originAction: pending.actionId,
      meta: {
        waitingFor,
        resumeAction,
        resumeMeta,
      },
    });

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

    span.complete(`wait: waiting for ${waitingFor}`);

    // Record trace completion in memory when useful for future decisions
    if (saveToMemory) {
      await recordTraceCompletion(ctx.memoryStore, ctx.trace, spans, store, {
        summary: `Waiting for ${waitingFor}. ${chainSummary}`,
      });
    }

    // Remove the processed action
    store.removePending(pending.actionId);

    return {
      spanId: span.id,
      terminal: true,
      enqueuedActions: [],
      reasoning: `wait: ${waitingFor}`,
    };
  },
};
