import { ACPProvider, parseJsonResponse } from '@endorhq/agent';
import { SpanWriter, ActionWriter } from '../logging.js';
import { replacePromptPlaceholders } from '../prompts.js';
import type { Span, PendingAction } from '../types.js';
import type { Step, StepConfig, StepContext, StepResult } from './types.js';
import planPromptTemplate from './prompts/plan-prompt.md';

interface PlanTask {
  title: string;
  workflow: string;
  acceptance_criteria: string[];
  inputs: Record<string, unknown>;
  context_uris?: string[];
  context: {
    files: string[];
    references: string[];
    depends_on: string | null;
  };
}

interface PlanResult {
  analysis: string;
  tasks: PlanTask[];
  execution_order: string;
  reasoning: string;
}

function buildPlanUserMessage(
  meta: Record<string, unknown>,
  spans: Span[]
): string {
  let msg = '## Plan Directive\n\n```json\n';
  msg += JSON.stringify(meta, null, 2);
  msg += '\n```\n';

  msg += '\n## Spans\n\n';
  msg += 'Previous spans provides you context an information to plan.\n\n';
  for (const span of spans) {
    msg += `### Span: ${span.step} (${span.id})\n\n`;
    msg += `- **timestamp**: ${span.timestamp}\n`;
    msg += `- **summary**: ${span.summary}\n`;
    msg += `- **parent**: ${span.parent ?? 'null'}\n\n`;
    msg += '```json\n';
    msg += JSON.stringify(span.meta, null, 2);
    msg += '\n```\n\n';
  }

  return msg;
}

function writeWorkflowActions(
  projectId: string,
  planResult: PlanResult,
  planSpanId: string
): Array<{ actionId: string; action: string }> {
  const titleToActionId = new Map<string, string>();
  const results: Array<{ actionId: string; action: string }> = [];

  for (const task of planResult.tasks) {
    const dependsOnActionId = task.context.depends_on
      ? (titleToActionId.get(task.context.depends_on) ?? null)
      : null;

    const descriptionRaw = (task.inputs?.description as string) ?? task.title;
    const description =
      descriptionRaw.length > 200
        ? `${descriptionRaw.slice(0, 200)}\u2026`
        : descriptionRaw;

    const action = new ActionWriter(projectId, {
      action: 'workflow',
      spanId: planSpanId,
      reasoning: description,
      meta: {
        workflow: task.workflow,
        title: task.title,
        acceptance_criteria: task.acceptance_criteria,
        context: task.context,
        depends_on: dependsOnActionId,
        inputs: task.inputs ?? {},
        ...(task.context_uris?.length
          ? { context_uris: task.context_uris }
          : {}),
      },
    });

    titleToActionId.set(task.title, action.id);
    results.push({ actionId: action.id, action: 'workflow' });
  }

  return results;
}

export const plannerStep: Step = {
  config: {
    actionType: 'plan',
    maxParallel: 2,
  } satisfies StepConfig,

  async process(pending: PendingAction, ctx: StepContext): Promise<StepResult> {
    const { store, projectId, projectPath } = ctx;

    // Read full action from disk for spanId (parent) and meta
    const actionData = store.readAction(pending.actionId);

    const span = new SpanWriter(projectId, {
      step: 'plan',
      parentId: actionData?.spanId ?? null,
      originAction: pending.actionId,
    });

    try {
      // Reconstruct span trace
      const spans = store.getSpanTrace(actionData?.spanId ?? '');

      // Build user message from action meta + spans
      const userMessage = buildPlanUserMessage(actionData?.meta ?? {}, spans);

      // Build system prompt with shared placeholders
      const systemPrompt = replacePromptPlaceholders(planPromptTemplate, {
        workflowStore: ctx.workflowStore,
        memoryCollection: ctx.memoryStore?.collectionName,
      });

      // Invoke AI via ACP
      const provider = ACPProvider.fromProject(projectPath);
      const response = await provider.invoke(userMessage, {
        json: true,
        systemPrompt,
        cwd: projectPath,
      });

      const planResult = parseJsonResponse<PlanResult>(response.response);
      if (!planResult) {
        span.fail('Failed to parse plan result from AI response');
        ctx.failTrace('Failed to parse plan result from AI response');
        return { spanId: span.id, terminal: true };
      }

      // No tasks — the planner decided nothing needs to be done
      if (!planResult.tasks || planResult.tasks.length === 0) {
        span.complete(
          `plan: noop — ${planResult.reasoning || 'no tasks needed'}`,
          { analysis: planResult.analysis }
        );

        const noop = new ActionWriter(projectId, {
          action: 'noop',
          spanId: span.id,
          reasoning: planResult.reasoning || 'Plan produced no tasks',
        });

        return {
          spanId: span.id,
          terminal: false,
          newActions: [{ actionId: noop.id, action: 'noop' }],
        };
      }

      for (const task of planResult.tasks) {
        if (ctx.workflowStore) {
          const wf = ctx.workflowStore.getWorkflow(task.workflow);
          if (!wf) {
            const reason = `Invalid workflow type: ${task.workflow}`;
            span.fail(reason);
            ctx.failTrace(reason);
            return { spanId: span.id, terminal: true };
          }
        }
      }

      // Complete the plan span
      span.complete(`plan: ${actionData?.reasoning ?? pending.action}`, {
        analysis: planResult.analysis,
        taskCount: planResult.tasks.length,
        executionOrder: planResult.execution_order,
      });

      // Write workflow action files
      const newActions = writeWorkflowActions(projectId, planResult, span.id);

      return { spanId: span.id, terminal: false, newActions };
    } catch (error) {
      span.error(
        `Planner failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  },
};
