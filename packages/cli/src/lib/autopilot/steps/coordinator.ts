import { ACPProvider, parseJsonResponse } from '@endorhq/agent';
import { SpanWriter, ActionWriter } from '../logging.js';
import { replacePromptPlaceholders } from '../prompts.js';
import type { PromptPlaceholderVars } from '../prompts.js';
import type { PendingAction } from '../types.js';
import type { Step, StepConfig, StepContext, StepResult } from './types.js';
import coordinatorPromptTemplate from './prompts/coordinator-prompt.md';

interface CoordinatorDecision {
  action: string;
  confidence: string;
  reasoning: string;
  context: string;
  meta: Record<string, unknown>;
}

const VALID_ACTIONS = new Set([
  'plan',
  'notify',
  'workflow',
  'wait',
  'noop',
  'cleanup',
]);

/**
 * Build the coordinator system prompt from the template, replacing shared
 * placeholders and appending the anti-recursion constraint.
 */
export function buildCoordinatorPrompt(vars: PromptPlaceholderVars): string {
  let prompt = replacePromptPlaceholders(coordinatorPromptTemplate, vars);

  prompt +=
    '\n\n## Constraint\n\nThe `coordinate` action is NOT available for this decision. You must choose one of the other actions.\n';

  return prompt;
}

export const coordinatorStep: Step = {
  config: {
    actionType: 'coordinate',
    maxParallel: 3,
  } satisfies StepConfig,

  async process(pending: PendingAction, ctx: StepContext): Promise<StepResult> {
    const { store, project } = ctx;
    const projectId = project.id;
    const projectPath = project.path;

    // Read full action from disk for spanId (parent) and meta (event JSON)
    const actionData = store.readAction(pending.actionId);

    const span = new SpanWriter(projectId, {
      step: 'coordinate',
      parentId: actionData?.spanId ?? null,
      originAction: pending.actionId,
      meta: actionData?.meta ?? {},
    });

    try {
      // Build system prompt
      const systemPrompt = buildCoordinatorPrompt({
        workflowStore: ctx.workflowStore,
        memoryCollection: ctx.memoryStore?.collectionName,
        botName: ctx.botName,
        customInstructions: ctx.customInstructions,
      });

      // Build user message from event JSON
      const eventMeta = actionData?.meta ?? {};
      let userMessage =
        '## Event\n\n```json\n' +
        JSON.stringify(eventMeta, null, 2) +
        '\n```\n';

      // Inject wait queue context (filtered by same traceId)
      const waitQueue = store
        .getWaitQueue()
        .filter(e => e.traceId === pending.traceId);
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

      // Invoke AI via ACP
      const provider = ACPProvider.fromProject(projectPath);
      const response = await provider.invoke(userMessage, {
        json: true,
        systemPrompt,
        cwd: projectPath,
      });

      const decision = parseJsonResponse<CoordinatorDecision>(response);
      if (!decision) {
        throw new Error(
          'Failed to parse coordinator decision from AI response'
        );
      }

      // Reject unknown actions and recursive coordinate — this is an AI error
      if (!VALID_ACTIONS.has(decision.action)) {
        let reason = `Unknown action "${decision.action}" rejected. Original reasoning: ${decision.reasoning}`;

        if (decision.action === 'coordinate') {
          reason = `Recursive coordinate action rejected: coordinate is not available as a sub-action. Original reasoning: ${decision.reasoning}`;
        }

        span.fail(reason, {
          originalAction: decision.action,
          context: decision.context,
        });
        ctx.failTrace(reason);
        return { spanId: span.id, terminal: true };
      }

      // Remove satisfied wait entries
      if (decision.meta?.satisfied_wait_id) {
        store.removeWaitEntry(decision.meta.satisfied_wait_id as string);
      }

      // Complete span
      const summary = `coordinate: ${decision.action} — ${actionData?.reasoning ?? pending.action}`;
      span.complete(summary, {
        ...decision.meta,
        context: decision.context,
      });

      // Create follow-up action on disk (orchestrator handles enqueuing)
      const action = new ActionWriter(projectId, {
        action: decision.action,
        spanId: span.id,
        reasoning: decision.reasoning,
        meta: decision.meta,
      });

      return {
        spanId: span.id,
        terminal: false,
        newActions: [
          {
            actionId: action.id,
            action: decision.action,
          },
        ],
      };
    } catch (error) {
      span.error(
        `Coordinator failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  },
};
