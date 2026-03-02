import { getUserAIAgent, getAIAgentTool } from '../../agents/index.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { SpanWriter, ActionWriter, enqueueAction } from '../logging.js';
import { buildWorkflowCatalog } from '../helpers.js';
import type { PendingAction, PilotDecision } from '../types.js';
import type {
  Step,
  StepConfig,
  StepDependencies,
  StepContext,
  StepResult,
} from './types.js';
import {
  loadCustomInstructions,
  formatCustomInstructions,
  formatMaintainers,
} from './custom-instructions.js';
import pilotPromptTemplate from './prompts/pilot-prompt.md';

export function buildPilotPrompt(
  workflowCatalog?: string,
  memoryCollection?: string,
  botName?: string,
  projectPath?: string,
  maintainers?: string[]
): string {
  let prompt = pilotPromptTemplate;

  // Inject workflow catalog
  prompt = prompt.replace(
    '{{WORKFLOW_CATALOG}}',
    workflowCatalog || '*(No workflows available)*'
  );

  // Inject memory collection name
  prompt = prompt.replaceAll(
    '{{MEMORY_COLLECTION}}',
    memoryCollection || 'rover-memory'
  );

  // Inject bot account name
  prompt = prompt.replaceAll('{{BOT_ACCOUNT}}', botName || 'the bot account');

  prompt +=
    '\n\n## Constraint\n\nThe `coordinate` action is NOT available for this decision. You must choose one of the other actions.\n';

  prompt += formatMaintainers(maintainers);

  if (projectPath) {
    const instructions = loadCustomInstructions(projectPath, 'coordinate');
    prompt += formatCustomInstructions(instructions);
  }

  return prompt;
}

export const coordinatorStep: Step = {
  config: {
    actionType: 'coordinate',
    maxParallel: 3,
  } satisfies StepConfig,

  dependencies: {} satisfies StepDependencies,

  async process(pending: PendingAction, ctx: StepContext): Promise<StepResult> {
    const { store, projectId, projectPath } = ctx;

    // Open the coordinator span
    const span = new SpanWriter(projectId, {
      step: 'coordinate',
      parentId: pending.spanId,
      originAction: pending.actionId,
      meta: pending.meta ?? {},
    });

    // Build workflow catalog
    const catalog = ctx.workflowStore
      ? buildWorkflowCatalog(ctx.workflowStore)
      : '*(No workflows available)*';

    // Build system prompt and user message
    const systemPrompt = buildPilotPrompt(
      catalog,
      ctx.memoryStore?.collectionName,
      ctx.botName,
      projectPath,
      ctx.maintainers
    );

    const userMessage =
      '## Event\n\n```json\n' +
      JSON.stringify(pending.meta ?? {}, null, 2) +
      '\n```\n';

    const agent = getUserAIAgent();
    const agentTool = getAIAgentTool(agent);
    const response = await agentTool.invoke(userMessage, {
      json: true,
      model: 'sonnet',
      cwd: projectPath,
      systemPrompt,
      tools: [
        'Read',
        'Glob',
        'Grep',
        'Bash(gh:*)',
        'Bash(git:*)',
        'Bash(qmd:*)',
      ],
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
