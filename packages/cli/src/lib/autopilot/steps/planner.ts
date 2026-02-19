import { getUserAIAgent, getAIAgentTool } from '../../agents/index.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { SpanWriter, ActionWriter, enqueueAction } from '../logging.js';
import type { PendingAction, PlanResult, PlanTask, Span } from '../types.js';
import type {
  Step,
  StepConfig,
  StepDependencies,
  StepContext,
  StepResult,
} from './types.js';
import planPromptTemplate from './prompts/plan-prompt.md';

const VALID_WORKFLOWS = new Set([
  'swe',
  'code-review',
  'bug-finder',
  'security-analyst',
]);

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

    const description =
      task.description.length > 200
        ? task.description.slice(0, 200) + '\u2026'
        : task.description;

    const action = new ActionWriter(projectId, {
      action: 'workflow',
      spanId: planSpanId,
      reasoning: `${task.title}: ${description}`,
      meta: {
        workflow: task.workflow,
        title: task.title,
        description: task.description,
        acceptance_criteria: task.acceptance_criteria,
        context: task.context,
        depends_on_action_id: dependsOnActionId,
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
    const { store, projectId, projectPath } = ctx;

    // Open the plan span
    const span = new SpanWriter(projectId, {
      step: 'plan',
      parentId: pending.spanId,
    });

    // Reconstruct span trace
    const spans = store.getSpanTrace(pending.spanId);

    // Build user message from pending.meta + spans
    const userMessage = buildPlanUserMessage(pending.meta ?? {}, spans);

    // Invoke agent with system prompt and read-only tools
    const agent = getUserAIAgent();
    const agentTool = getAIAgentTool(agent);
    const response = await agentTool.invoke(userMessage, {
      json: true,
      cwd: projectPath,
      systemPrompt: planPromptTemplate,
      tools: ['Read', 'Glob', 'Grep'],
    });

    const planResult = parseJsonResponse<PlanResult>(response);

    // Validate: non-empty tasks, valid workflow types
    if (!planResult.tasks || planResult.tasks.length === 0) {
      throw new Error('Plan produced no tasks');
    }

    for (const task of planResult.tasks) {
      if (!VALID_WORKFLOWS.has(task.workflow)) {
        throw new Error(`Invalid workflow type: ${task.workflow}`);
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
