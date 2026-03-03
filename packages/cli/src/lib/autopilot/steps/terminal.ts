import { SpanWriter } from '../logging.js';
import { summarizeChain } from '../summarizer.js';
import { recordTraceCompletion } from '../memory/writer.js';
import type { PendingAction, Span } from '../types.js';
import type { StepContext, StepResult } from './types.js';
import type { SummaryResult } from '../summarizer.js';

/**
 * Hook result returned by the step-specific callback.
 *
 * - `summary` — the span completion summary text.
 * - `reasoning` — the StepResult reasoning string.
 * - `memorySummary` — optional override for the memory entry text.
 *   When omitted, `chainSummary` is used.
 * - `spanFinalized` — set to true if the hook already called
 *   `span.complete()` (e.g. to pass extraMeta). Prevents double-finalize.
 */
export interface TerminalHookResult {
  summary: string;
  reasoning: string;
  memorySummary?: string;
  spanFinalized?: boolean;
}

/**
 * Shared skeleton for terminal steps (noop, wait, cleanup).
 *
 * Handles the common boilerplate:
 * 1. Retrieve the span trace.
 * 2. Summarize the chain via the AI summarizer.
 * 3. Create a `SpanWriter`.
 * 4. Run the step-specific hook.
 * 5. Finalize the span.
 * 6. Conditionally record the trace in memory.
 * 7. Remove the pending action.
 * 8. Return a terminal `StepResult`.
 */
export async function processTerminalStep(
  pending: PendingAction,
  ctx: StepContext,
  opts: {
    stepName: string;
    buildSpanMeta: (chainSummary: string) => Record<string, any>;
    hook: (params: {
      span: SpanWriter;
      spans: Span[];
      chainSummary: string;
      saveToMemory: boolean;
    }) => Promise<TerminalHookResult> | TerminalHookResult;
  }
): Promise<StepResult> {
  const { store, projectId, projectPath } = ctx;

  // 1. Retrieve the full span chain
  const spans = store.getSpanTrace(pending.spanId);

  // 2. Summarize the chain
  const { summary: chainSummary, saveToMemory }: SummaryResult =
    await summarizeChain(spans, ctx.trace, projectPath, ctx.maintainers);

  // 3. Create the span
  const span = new SpanWriter(projectId, {
    step: opts.stepName,
    parentId: pending.spanId,
    originAction: pending.actionId,
    meta: opts.buildSpanMeta(chainSummary),
  });

  // 4. Run step-specific hook
  const hookResult = await opts.hook({
    span,
    spans,
    chainSummary,
    saveToMemory,
  });

  // 5. Finalize the span (skip if the hook already did it)
  if (!hookResult.spanFinalized) {
    span.complete(hookResult.summary);
  }

  // 6. Conditionally record trace completion in memory
  if (saveToMemory) {
    await recordTraceCompletion(ctx.memoryStore, ctx.trace, spans, store, {
      summary: hookResult.memorySummary ?? chainSummary,
    });
  }

  // 7. Remove the processed action
  store.removePending(pending.actionId);

  // 8. Return terminal result
  return {
    spanId: span.id,
    terminal: true,
    enqueuedActions: [],
    reasoning: hookResult.reasoning,
  };
}
