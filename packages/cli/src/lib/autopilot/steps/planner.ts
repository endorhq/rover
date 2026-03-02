import { getUserAIAgent, getAIAgentTool } from '../../agents/index.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { SpanWriter, ActionWriter, enqueueAction } from '../logging.js';
import { buildWorkflowCatalog } from '../helpers.js';
import type { PendingAction, PlanResult, PlanTask, Span } from '../types.js';
import type {
  Step,
  StepConfig,
  StepDependencies,
  StepContext,
  StepResult,
} from './types.js';
import planPromptTemplate from './prompts/plan-prompt.md';

function buildPlanUserMessage(
  meta: Record<string, any>,
  spans: Span[]
): string {
  let msg = '## Plan Directive\n\n```json\n';
  msg += JSON.stringify(meta, null, 2);
  msg += '\n```\n';

  msg += '\n## Spans\n\n';
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
  sourcePending: PendingAction,
  planResult: PlanResult,
  planSpanId: string,
  store: import('../store.js').AutopilotStore
): Array<{ task: PlanTask; actionId: string }> {
  // First pass: create ActionWriters and build title -> actionId map
  const titleToActionId = new Map<string, string>();
  const taskActions: Array<{ task: PlanTask; action: ActionWriter }> = [];

  for (const task of planResult.tasks) {
    const dependsOnActionId = task.context.depends_on
      ? (titleToActionId.get(task.context.depends_on) ?? null)
      : null;

    const descriptionRaw = task.inputs?.description ?? task.title;
    const description =
      descriptionRaw.length > 200
        ? descriptionRaw.slice(0, 200) + '\u2026'
        : descriptionRaw;

    const action = new ActionWriter(projectId, {
      action: 'workflow',
      spanId: planSpanId,
      reasoning: `${task.title}: ${description}`,
      meta: {
        workflow: task.workflow,
        title: task.title,
        acceptance_criteria: task.acceptance_criteria,
        context: task.context,
        depends_on_action_id: dependsOnActionId,
        inputs: task.inputs ?? {},
        ...(task.context_uris?.length
          ? { context_uris: task.context_uris }
          : {}),
      },
    });

    titleToActionId.set(task.title, action.id);
    taskActions.push({ task, action });
  }

  // Second pass: enqueue each action
  for (const { task, action } of taskActions) {
    enqueueAction(store, {
      traceId: sourcePending.traceId,
      action,
      step: 'plan',
      summary: `${task.workflow}: ${task.title}`,
    });
  }

  return taskActions.map(({ task, action }) => ({
    task,
    actionId: action.id,
  }));
}

export const plannerStep: Step = {
  config: {
    actionType: 'plan',
    maxParallel: 2,
  } satisfies StepConfig,

  dependencies: {} satisfies StepDependencies,

  async process(pending: PendingAction, ctx: StepContext): Promise<StepResult> {
    const { store, projectId, projectPath, workflowStore } = ctx;

    // Open the plan span
    const span = new SpanWriter(projectId, {
      step: 'plan',
      parentId: pending.spanId,
      originAction: pending.actionId,
    });

    // Reconstruct span trace
    const spans = store.getSpanTrace(pending.spanId);

    // Build user message from pending.meta + spans
    let userMessage = buildPlanUserMessage(pending.meta ?? {}, spans);

    // Build system prompt with dynamic workflow catalog and memory collection
    let systemPrompt = planPromptTemplate;
    if (workflowStore) {
      const catalog = buildWorkflowCatalog(workflowStore);
      systemPrompt = systemPrompt.replace('{{WORKFLOW_CATALOG}}', catalog);
    }
    systemPrompt = systemPrompt.replaceAll(
      '{{MEMORY_COLLECTION}}',
      ctx.memoryStore?.collectionName || 'rover-memory'
    );

    // Invoke agent with system prompt and read-only tools
    const agent = getUserAIAgent();
    const agentTool = getAIAgentTool(agent);
    const response = await agentTool.invoke(userMessage, {
      json: true,
      cwd: projectPath,
      systemPrompt,
      tools: ['Read', 'Glob', 'Grep', 'Bash(gh:*)', 'Bash(qmd:*)'],
    });

    const planResult = parseJsonResponse<PlanResult>(response);

    // Validate: non-empty tasks, valid workflow types
    if (!planResult.tasks || planResult.tasks.length === 0) {
      throw new Error('Plan produced no tasks');
    }

    for (const task of planResult.tasks) {
      if (workflowStore) {
        const wf = workflowStore.getWorkflow(task.workflow);
        if (!wf) {
          throw new Error(`Invalid workflow type: ${task.workflow}`);
        }
      }
    }

    // Finalize the plan span
    span.complete(`plan: ${pending.summary}`, {
      analysis: planResult.analysis,
      taskCount: planResult.tasks.length,
      executionOrder: planResult.execution_order,
    });

    // Write workflow action files, enqueue pending actions, and log per task
    const taskEntries = writeWorkflowActions(
      projectId,
      pending,
      planResult,
      span.id,
      store
    );

    // Remove processed plan action from pending
    store.removePending(pending.actionId);

    return {
      spanId: span.id,
      terminal: false,
      enqueuedActions: taskEntries.map(({ task, actionId }) => ({
        actionId,
        actionType: task.workflow,
        summary: task.title,
      })),
      reasoning: `${planResult.tasks.length} task(s), ${planResult.execution_order}`,
    };
  },
};
