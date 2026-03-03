import { getUserAIAgent, getAIAgentTool } from '../../agents/index.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { SpanWriter, ActionWriter, enqueueAction } from '../logging.js';
import { buildWorkflowCatalog } from '../helpers.js';
import type { PendingAction, CoordinatorDecision } from '../types.js';
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
import coordinatorPromptTemplate from './prompts/coordinator-prompt.md';

export function buildCoordinatorPrompt(
  workflowCatalog?: string,
  memoryCollection?: string,
  botName?: string,
  projectPath?: string,
  maintainers?: string[],
  customInstructions?: string
): string {
  let prompt = coordinatorPromptTemplate;

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

  // Inject custom instructions into the Phase 3 placeholder.
  // Use the same layering as every other step: file-based instructions
  // include both general + step-specific (with step-specific marked as
  // taking precedence). The `customInstructions` parameter, when set,
  // is treated as an additional override appended after file-based ones.
  let resolvedInstructions = '';
  if (projectPath) {
    const fileInstructions = loadCustomInstructions(projectPath, 'coordinate');
    resolvedInstructions = formatCustomInstructions(fileInstructions);
  }
  if (customInstructions) {
    resolvedInstructions +=
      (resolvedInstructions ? '\n\n' : '') + customInstructions;
  }
  prompt = prompt.replace('{{CUSTOM_INSTRUCTIONS}}', resolvedInstructions);

  prompt +=
    '\n\n## Constraint\n\nThe `coordinate` action is NOT available for this decision. You must choose one of the other actions.\n';

  prompt += formatMaintainers(maintainers);

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
    const systemPrompt = buildCoordinatorPrompt(
      catalog,
      ctx.memoryStore?.collectionName,
      ctx.botName,
      projectPath,
      ctx.maintainers,
      ctx.customInstructions
    );

    let userMessage =
      '## Event\n\n```json\n' +
      JSON.stringify(pending.meta ?? {}, null, 2) +
      '\n```\n';

    // Inject wait queue context
    const waitQueue = store.getWaitQueue();
    if (waitQueue.length > 0) {
      userMessage += '\n## Waiting Queue\n\n';
      userMessage += 'Items waiting for conditions to be met. ';
      userMessage +=
        'If the current event satisfies any condition, factor it into your decision.\n\n';
      for (const entry of waitQueue) {
        userMessage += `- **Waiting for**: ${entry.waitingFor}\n`;
        userMessage += `  **Resume action**: ${entry.resumeAction}\n`;
        userMessage += `  **Original event**: ${entry.eventSummary}\n`;
        userMessage += `  **Action ID**: ${entry.actionId}\n`;
        userMessage += `  **Since**: ${entry.createdAt}\n\n`;
      }
    }

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
        'Bash(rover:*)',
      ],
    });
    const decision = parseJsonResponse<CoordinatorDecision>(response);

    // Safety: prevent recursive coordinate
    if (decision.action === 'coordinate') {
      decision.action = 'noop';
      decision.reasoning =
        'Forced to noop: coordinate is not available as a sub-action.';
    }

    // Backward compat: route clarify decisions to the notify step
    if (decision.action === 'clarify') {
      decision.action = 'notify';
      decision.meta = { ...decision.meta, intent: 'clarify' };
    }

    // Backward compat: route flag decisions to the notify step
    if (decision.action === 'flag') {
      decision.action = 'notify';
      decision.meta = { ...decision.meta, intent: 'flag' };
    }

    // Remove satisfied wait entries
    if (decision.meta?.satisfied_wait_id) {
      store.removeWaitEntry(decision.meta.satisfied_wait_id);
    }

    // Write follow-up action. Every decision produces an action — the
    // coordinator is never an end step.
    const action = new ActionWriter(projectId, {
      action: decision.action,
      spanId: span.id,
      reasoning: decision.reasoning,
      meta: decision.meta,
    });

    // Store gathered context in span for downstream steps
    span.complete(`coordinate: ${decision.action} — ${pending.summary}`, {
      ...decision.meta,
      context: decision.context,
    });

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
