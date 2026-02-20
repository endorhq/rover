import { getUserAIAgent, getAIAgentTool } from '../../agents/index.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { SpanWriter, ActionWriter, enqueueAction } from '../logging.js';
import { fetchContextForAction } from '../context.js';
import type { PendingAction, PilotDecision } from '../types.js';
import type {
  Step,
  StepConfig,
  StepDependencies,
  StepContext,
  StepResult,
} from './types.js';
import pilotPromptTemplate from './prompts/pilot-prompt.md';

function buildPilotPrompt(
  meta: Record<string, any>,
  context: { type: string; data: Record<string, any> } | null
): string {
  let prompt = pilotPromptTemplate;

  prompt += '\n\n---\n\n## Event\n\n```json\n';
  prompt += JSON.stringify(meta, null, 2);
  prompt += '\n```\n';

  if (context) {
    prompt += '\n## Additional Context\n\n```json\n';
    prompt += JSON.stringify(context.data, null, 2);
    prompt += '\n```\n';
  }

  prompt += '\n## Workflows\n\nNo workflows are currently available.\n';
  prompt +=
    '\n## Constraint\n\nThe `coordinate` action is NOT available for this decision. You must choose one of the other actions.\n';

  return prompt;
}

export const coordinatorStep: Step = {
  config: {
    actionType: 'coordinate',
    maxParallel: 3,
  } satisfies StepConfig,

  dependencies: {
    needsOwnerRepo: true,
  } satisfies StepDependencies,

  async process(pending: PendingAction, ctx: StepContext): Promise<StepResult> {
    const { store, projectId, owner, repo } = ctx;

    if (!owner || !repo) {
      throw new Error('Coordinator requires owner and repo');
    }

    // Open the coordinator span
    const span = new SpanWriter(projectId, {
      step: 'coordinate',
      parentId: pending.spanId,
      meta: pending.meta ?? {},
    });

    // Fetch additional context
    const context = pending.meta
      ? await fetchContextForAction(owner, repo, pending.meta)
      : null;

    // Build prompt and invoke Pilot
    const prompt = buildPilotPrompt(pending.meta ?? {}, context);
    const agent = getUserAIAgent();
    const agentTool = getAIAgentTool(agent);
    const response = await agentTool.invoke(prompt, {
      json: true,
      model: 'haiku',
    });
    const decision = parseJsonResponse<PilotDecision>(response);

    // Safety: prevent recursive coordinate
    if (decision.action === 'coordinate') {
      decision.action = 'noop';
      decision.reasoning =
        'Forced to noop: coordinate is not available as a sub-action.';
    }

    // Route clarify decisions to the notify step
    if (decision.action === 'clarify') {
      decision.action = 'notify';
      decision.meta = { ...decision.meta, originalAction: 'clarify' };
    }

    // Write follow-up action. Every decision produces an action — the
    // coordinator is never an end step.
    const action = new ActionWriter(projectId, {
      action: decision.action,
      spanId: span.id,
      reasoning: decision.reasoning,
      meta: decision.meta,
    });

    span.complete(
      `coordinate: ${decision.action} — ${pending.summary}`,
      decision.meta
    );

    // Enqueue the action for the next step to pick up (including noop)
    enqueueAction(store, {
      traceId: pending.traceId,
      action,
      step: 'coordinate',
      summary: `${decision.action}: ${pending.summary}`,
    });

    // Remove the processed coordinate action
    store.removePending(pending.actionId);

    return {
      spanId: span.id,
      terminal: false,
      enqueuedActions: [
        {
          actionId: action.id,
          actionType: decision.action,
          summary: decision.reasoning,
        },
      ],
      reasoning: `${decision.action} (${decision.confidence})`,
    };
  },
};
