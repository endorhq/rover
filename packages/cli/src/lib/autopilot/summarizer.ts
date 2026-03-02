import { getUserAIAgent, getAIAgentTool } from '../agents/index.js';
import { parseJsonResponse } from '../../utils/json-parser.js';
import type { Span, ActionTrace, SummaryAIResult } from './types.js';
import {
  loadCustomInstructions,
  formatCustomInstructions,
  formatMaintainers,
} from './steps/custom-instructions.js';
import summaryPromptTemplate from './steps/prompts/summary-prompt.md';

export interface SummaryResult {
  summary: string;
  saveToMemory: boolean;
}

/**
 * Summarize a span chain and trace into a human-readable string.
 *
 * This is a generic helper that any end step (noop, push, fail) can call
 * to produce a `meta.summary` for the final span. It invokes a lightweight
 * AI model (haiku) to generate the summary, falling back to a simple
 * concatenation of span summaries if the AI call fails.
 *
 * Returns both the summary text and a `saveToMemory` flag indicating
 * whether this trace contains information worth persisting for future
 * coordination decisions.
 */
export async function summarizeChain(
  spans: Span[],
  trace: ActionTrace,
  projectPath: string,
  maintainers?: string[]
): Promise<SummaryResult> {
  try {
    const input = {
      spans: spans.map(s => ({
        step: s.step,
        status: s.status,
        summary: s.summary,
        meta: s.meta,
      })),
      steps: trace.steps.map(s => ({
        action: s.action,
        status: s.status,
        reasoning: s.reasoning ?? null,
      })),
    };

    const userMessage = '```json\n' + JSON.stringify(input, null, 2) + '\n```';

    let systemPrompt: string = summaryPromptTemplate;
    systemPrompt += formatMaintainers(maintainers);
    systemPrompt += formatCustomInstructions(
      loadCustomInstructions(projectPath, 'noop')
    );

    const agent = getUserAIAgent();
    const agentTool = getAIAgentTool(agent);
    const response = await agentTool.invoke(userMessage, {
      json: true,
      model: 'haiku',
      systemPrompt,
    });

    const result = parseJsonResponse<SummaryAIResult>(response);
    return {
      summary: result.summary,
      saveToMemory: result.saveToMemory ?? false,
    };
  } catch {
    // Fallback: concatenate span summaries
    return {
      summary: spans
        .map(s => s.summary)
        .filter(Boolean)
        .join(' -> '),
      saveToMemory: false,
    };
  }
}
