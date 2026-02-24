import type { WorkflowStore } from 'rover-core';
import { getUserAIAgent, getAIAgentTool } from '../../agents/index.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { SpanWriter, ActionWriter, enqueueAction } from '../logging.js';
import { buildPlannerQuery, fetchMemoryContext } from '../memory/reader.js';
import type { PendingAction, PlanResult, PlanTask, Span } from '../types.js';
import type {
  Step,
  StepConfig,
  StepDependencies,
  StepContext,
  StepResult,
} from './types.js';
import planPromptTemplate from './prompts/plan-prompt.md';

/**
 * Build a Markdown catalog of available workflows from the WorkflowStore.
 * This is injected into the planner prompt so the AI knows which workflows exist.
 */
function buildWorkflowCatalog(workflowStore: WorkflowStore): string {
  const entries = workflowStore.getAllWorkflowEntries();
  if (entries.length === 0) {
    return '*(No workflows available)*';
  }

  const sections: string[] = [];

  for (const entry of entries) {
    const wf = entry.workflow;
    let section = `### \`${wf.name}\` — ${wf.description}\n\n`;

    // Inputs
    if (wf.inputs.length > 0) {
      section += '**Inputs**:\n';
      for (const input of wf.inputs) {
        const req = input.required ? 'required' : 'optional';
        const def =
          input.default !== undefined ? `, default: \`${input.default}\`` : '';
        section += `- \`${input.name}\` (${input.type}, ${req}${def}) — ${input.description}\n`;
      }
      section += '\n';
    }

    // Outputs
    if (wf.outputs.length > 0) {
      section += '**Outputs**:\n';
      for (const output of wf.outputs) {
        section += `- \`${output.name}\` (${output.type}) — ${output.description}\n`;
      }
      section += '\n';
    }

    // Steps summary
    if (wf.steps.length > 0) {
      section += '**Steps**: ';
      section += wf.steps.map(s => `\`${s.id}\``).join(' → ');
      section += '\n';
    }

    sections.push(section);
  }

  return sections.join('\n');
}

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
        ...(task.inputs ? { inputs: task.inputs } : {}),
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
    });

    // Reconstruct span trace
    const spans = store.getSpanTrace(pending.spanId);

    // Build user message from pending.meta + spans
    let userMessage = buildPlanUserMessage(pending.meta ?? {}, spans);

    // Fetch and append memory context
    const memoryQuery = buildPlannerQuery(pending.meta ?? {}, spans);
    const memory = await fetchMemoryContext(ctx.memoryStore, memoryQuery, 5);
    if (memory.content) {
      userMessage += '\n' + memory.content;
    }

    // Build system prompt with dynamic workflow catalog
    let systemPrompt = planPromptTemplate;
    if (workflowStore) {
      const catalog = buildWorkflowCatalog(workflowStore);
      systemPrompt = systemPrompt.replace('{{WORKFLOW_CATALOG}}', catalog);
    }

    // Invoke agent with system prompt and read-only tools
    const agent = getUserAIAgent();
    const agentTool = getAIAgentTool(agent);
    const response = await agentTool.invoke(userMessage, {
      json: true,
      cwd: projectPath,
      systemPrompt,
      tools: ['Read', 'Glob', 'Grep', 'Bash(gh:*)'],
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
