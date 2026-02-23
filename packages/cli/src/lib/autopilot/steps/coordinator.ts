import { getUserAIAgent, getAIAgentTool } from '../../agents/index.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { SpanWriter, ActionWriter, enqueueAction } from '../logging.js';
import { fetchContextForAction } from '../context.js';
import type { PendingAction, PilotDecision, TaskMapping } from '../types.js';
import type {
  Step,
  StepConfig,
  StepDependencies,
  StepContext,
  StepResult,
} from './types.js';
import pilotPromptTemplate from './prompts/pilot-prompt.md';

interface RoverContext {
  taskId: number;
  branchName: string;
  traceId?: string;
}

function buildPilotPrompt(
  meta: Record<string, any>,
  context: { type: string; data: Record<string, any> } | null,
  roverContext?: RoverContext
): string {
  let prompt = pilotPromptTemplate;

  if (roverContext) {
    prompt += '\n\n---\n\n## Automation Context\n\n';
    prompt +=
      'This PR was **created by the Rover automation system** as part of an earlier task.\n\n';
    prompt += `- **Task ID**: ${roverContext.taskId}\n`;
    prompt += `- **Branch**: \`${roverContext.branchName}\`\n`;
    if (roverContext.traceId) {
      prompt += `- **Original Trace**: \`${roverContext.traceId}\`\n`;
    }
    prompt += '\n';
    prompt +=
      'When users provide actionable feedback on a Rover-created PR, prefer `plan` over `clarify`. ';
    prompt +=
      'If the feedback is approval or positive acknowledgement, use `noop`. ';
    prompt +=
      'Only use `clarify` when the feedback is genuinely ambiguous and you cannot determine intent.\n';
  }

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

    // Check if this PR was created by Rover via task mappings
    let roverContext: RoverContext | undefined;
    const headRefName = context?.data?.headRefName as string | undefined;
    if (headRefName) {
      const allMappings = store.getAllTaskMappings();
      for (const [, mapping] of Object.entries(allMappings)) {
        if (mapping.branchName === headRefName) {
          roverContext = {
            taskId: mapping.taskId,
            branchName: mapping.branchName,
            traceId: mapping.traceId,
          };
          break;
        }
      }
    }

    // Build prompt and invoke Pilot
    const prompt = buildPilotPrompt(pending.meta ?? {}, context, roverContext);
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
