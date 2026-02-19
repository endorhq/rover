import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { IterationManager } from 'rover-core';
import { getUserAIAgent, getAIAgentTool } from '../../agents/index.js';
import { parseJsonResponse } from '../../../utils/json-parser.js';
import { SpanWriter, ActionWriter, enqueueAction } from '../logging.js';
import type {
  PendingAction,
  ResolverDecision,
  ResolverAIResult,
  ActionTrace,
  Span,
} from '../types.js';
import type {
  Step,
  StepConfig,
  StepDependencies,
  StepContext,
  StepResult,
} from './types.js';
import resolvePromptTemplate from './prompts/resolve-prompt.md';

const MAX_RETRIES = 3;

// ── Deterministic decision paths ─────────────────────────────────────────────

type QuickDecision = {
  decision: ResolverDecision;
  reason: string;
} | null;

function tryQuickDecision(trace: ActionTrace): QuickDecision {
  const steps = trace.steps;

  // Workflow steps still running or pending -> wait
  const hasRunningWorkflow = steps.some(
    s =>
      s.action !== 'commit' &&
      s.action !== 'resolve' &&
      s.action !== 'push' &&
      (s.status === 'running' || s.status === 'pending')
  );
  if (hasRunningWorkflow) {
    return {
      decision: 'wait',
      reason: 'workflow steps still running or pending',
    };
  }

  // Commit steps still active -> wait
  const hasActiveCommit = steps.some(
    s =>
      s.action === 'commit' &&
      (s.status === 'pending' || s.status === 'running')
  );
  if (hasActiveCommit) {
    return { decision: 'wait', reason: 'commit steps still active' };
  }

  // All commit steps completed, no failures -> push
  const commitSteps = steps.filter(s => s.action === 'commit');
  const failedSteps = steps.filter(
    s => s.status === 'failed' && s.action !== 'resolve' && s.action !== 'push'
  );
  const allCommitsCompleted =
    commitSteps.length > 0 && commitSteps.every(s => s.status === 'completed');

  if (allCommitsCompleted && failedSteps.length === 0) {
    return { decision: 'push', reason: 'all commits completed' };
  }

  // Max retries exceeded -> fail
  if (failedSteps.length > 0) {
    const retryCount = trace.retryCount ?? 0;
    if (retryCount >= MAX_RETRIES) {
      return {
        decision: 'fail',
        reason: `max retries (${MAX_RETRIES}) exceeded`,
      };
    }
  }

  return null;
}

// ── AI-backed decision ───────────────────────────────────────────────────────

function buildResolverUserMessage(
  trace: ActionTrace,
  pending: PendingAction,
  failedStepDetails: Array<Record<string, any>>,
  spans: Span[]
): string {
  const input = {
    trace_summary: trace.summary,
    retry_count: trace.retryCount ?? 0,
    max_retries: MAX_RETRIES,
    steps: trace.steps.map(s => ({
      action: s.action,
      status: s.status,
      reasoning: s.reasoning ?? null,
    })),
    failed_steps: failedStepDetails,
    spans: spans.map(t => ({
      id: t.id,
      step: t.step,
      timestamp: t.timestamp,
      summary: t.summary,
      meta: t.meta,
    })),
  };

  return '```json\n' + JSON.stringify(input, null, 2) + '\n```';
}

async function askAIForDecision(
  trace: ActionTrace,
  pending: PendingAction,
  ctx: StepContext
): Promise<{
  decision: 'iterate' | 'fail';
  reason: string;
  iterateInstructions?: string;
}> {
  const { store, project, projectPath } = ctx;

  // Gather failed step details with task context
  const failedSteps = trace.steps.filter(
    s => s.status === 'failed' && s.action !== 'resolve' && s.action !== 'push'
  );

  const failedStepDetails: Array<Record<string, any>> = [];
  for (const step of failedSteps) {
    const detail: Record<string, any> = {
      action: step.action,
      reasoning: step.reasoning ?? 'unknown error',
    };

    const mapping = store.getTaskMapping(step.actionId);
    if (mapping && project) {
      const task = project.getTask(mapping.taskId);
      if (task) {
        detail.task_title = task.title;
        detail.task_description = task.description;
        detail.task_status = task.status;
        detail.error = task.error ?? null;
      }
    }

    if (pending.meta?.committed !== undefined) {
      detail.committed = pending.meta.committed;
    }
    if (pending.meta?.taskStatus) {
      detail.task_status = pending.meta.taskStatus;
    }

    failedStepDetails.push(detail);
  }

  const spans = store.getSpanTrace(pending.spanId);

  const userMessage = buildResolverUserMessage(
    trace,
    pending,
    failedStepDetails,
    spans
  );

  const agent = getUserAIAgent();
  const agentTool = getAIAgentTool(agent);
  const response = await agentTool.invoke(userMessage, {
    json: true,
    cwd: projectPath,
    systemPrompt: resolvePromptTemplate,
  });

  const result = parseJsonResponse<ResolverAIResult>(response);

  if (result.decision !== 'iterate' && result.decision !== 'fail') {
    return {
      decision: 'iterate',
      reason: `AI returned unexpected decision "${result.decision}", defaulting to iterate`,
      iterateInstructions:
        result.iterate_instructions ??
        'Retry the task, addressing any previous errors.',
    };
  }

  if (result.decision === 'iterate') {
    return {
      decision: 'iterate',
      reason: result.reasoning,
      iterateInstructions:
        result.iterate_instructions ??
        'Retry the task, addressing the errors from the previous attempt.',
    };
  }

  return {
    decision: 'fail',
    reason: result.fail_reason ?? result.reasoning,
  };
}

// ── Execute a decision ───────────────────────────────────────────────────────

function executeDecision(
  decision: ResolverDecision,
  reason: string,
  iterateInstructions: string | undefined,
  pending: PendingAction,
  trace: ActionTrace,
  ctx: StepContext
): StepResult {
  const { store, projectId, project } = ctx;

  switch (decision) {
    case 'wait': {
      store.removePending(pending.actionId);

      store.appendLog({
        ts: new Date().toISOString(),
        traceId: pending.traceId,
        spanId: pending.spanId,
        actionId: pending.actionId,
        step: 'resolve',
        action: 'wait',
        summary: `trace: ${trace.summary} — wait: ${reason}`,
      });

      return {
        spanId: pending.spanId,
        terminal: true,
        enqueuedActions: [],
        reasoning: `wait: ${reason}`,
      };
    }

    case 'push': {
      const resolveSpan = new SpanWriter(projectId, {
        step: 'resolve',
        parentId: pending.spanId,
        meta: { decision: 'push', reason },
      });
      resolveSpan.complete(`resolve: trace ready to push: ${trace.summary}`);

      const pushMeta = {
        ...pending.meta,
        decision: 'push',
      };

      const pushAction = new ActionWriter(projectId, {
        action: 'push',
        spanId: resolveSpan.id,
        reasoning: `Push trace: ${trace.summary}`,
        meta: pushMeta,
      });

      enqueueAction(store, {
        traceId: pending.traceId,
        action: pushAction,
        step: 'resolve',
        summary: `push: ${trace.summary}`,
      });

      store.removePending(pending.actionId);

      return {
        spanId: resolveSpan.id,
        terminal: false,
        enqueuedActions: [
          {
            actionId: pushAction.id,
            actionType: 'push',
            summary: 'all commits completed',
          },
        ],
        reasoning: `push: ${reason}`,
      };
    }

    case 'iterate': {
      if (!project) {
        store.removePending(pending.actionId);
        store.appendLog({
          ts: new Date().toISOString(),
          traceId: pending.traceId,
          spanId: pending.spanId,
          actionId: pending.actionId,
          step: 'resolve',
          action: 'fail',
          summary: `trace: ${trace.summary} — cannot iterate, no project manager`,
        });
        return {
          spanId: pending.spanId,
          terminal: true,
          enqueuedActions: [],
          reasoning: 'fail: no project manager for iterate',
        };
      }

      const failedWorkflowStep = trace.steps.find(
        s =>
          s.status === 'failed' &&
          s.action !== 'commit' &&
          s.action !== 'resolve' &&
          s.action !== 'push'
      );

      const failedActionId =
        failedWorkflowStep?.actionId ??
        trace.steps.find(s => s.status === 'failed' && s.action === 'commit')
          ?.actionId;

      const mapping = failedActionId
        ? store.getTaskMapping(failedActionId)
        : undefined;

      if (!mapping) {
        store.removePending(pending.actionId);
        store.appendLog({
          ts: new Date().toISOString(),
          traceId: pending.traceId,
          spanId: pending.spanId,
          actionId: pending.actionId,
          step: 'resolve',
          action: 'fail',
          summary: `trace: ${trace.summary} — cannot iterate, no task mapping`,
        });
        return {
          spanId: pending.spanId,
          terminal: true,
          enqueuedActions: [],
          reasoning: 'fail: no task mapping for failed step',
        };
      }

      const task = project.getTask(mapping.taskId);
      if (!task) {
        store.removePending(pending.actionId);
        return {
          spanId: pending.spanId,
          terminal: true,
          enqueuedActions: [],
          reasoning: `fail: task #${mapping.taskId} not found`,
        };
      }

      // Increment retry count on the trace
      trace.retryCount = (trace.retryCount ?? 0) + 1;

      // Create a new iteration on the failed task
      const newIterationNumber = task.iterations + 1;
      const iterationPath = join(
        task.iterationsPath(),
        newIterationNumber.toString()
      );
      mkdirSync(iterationPath, { recursive: true });

      task.incrementIteration();
      task.markIterating();

      const errorContext = failedWorkflowStep?.reasoning ?? 'unknown error';
      const iterationTitle = `Retry: ${task.title}`;
      const iterationDescription =
        iterateInstructions ??
        `Previous attempt failed: ${errorContext}\n\nPlease retry the task, addressing the failure.`;

      IterationManager.createIteration(
        iterationPath,
        newIterationNumber,
        task.id,
        iterationTitle,
        iterationDescription,
        {
          summary: errorContext,
          iterationNumber: newIterationNumber - 1,
        }
      );

      const resolveSpan = new SpanWriter(projectId, {
        step: 'resolve',
        parentId: pending.spanId,
        meta: {
          decision: 'iterate',
          reason,
          taskId: mapping.taskId,
          newIterationNumber,
          retryCount: trace.retryCount,
        },
      });
      resolveSpan.complete(
        `resolve: iterating task #${mapping.taskId}: ${reason}`
      );

      const workflowName = pending.meta?.workflow ?? 'swe';
      const workflowMeta = {
        workflow: workflowName,
        title: task.title,
        description: iterationDescription,
        acceptance_criteria: pending.meta?.acceptance_criteria ?? [],
        context: {
          files: pending.meta?.context?.files ?? [],
          references: pending.meta?.context?.references ?? [],
          depends_on: null,
        },
      };

      const workflowAction = new ActionWriter(projectId, {
        action: 'workflow',
        spanId: resolveSpan.id,
        reasoning: `${workflowName}: ${task.title} (retry #${trace.retryCount})`,
        meta: workflowMeta,
      });

      enqueueAction(store, {
        traceId: pending.traceId,
        action: workflowAction,
        step: 'resolve',
        summary: `${workflowName}: ${task.title}`,
      });

      store.removePending(pending.actionId);

      return {
        spanId: resolveSpan.id,
        terminal: false,
        enqueuedActions: [
          {
            actionId: workflowAction.id,
            actionType: workflowName,
            summary: `retry #${trace.retryCount}: ${task.title}`,
          },
        ],
        reasoning: `iterate: ${reason}`,
      };
    }

    case 'fail': {
      const resolveSpan = new SpanWriter(projectId, {
        step: 'resolve',
        parentId: pending.spanId,
        meta: { decision: 'fail', reason },
      });
      resolveSpan.fail(`resolve: trace failed: ${trace.summary}`);

      // Mark all pending steps as failed via traceMutations
      const stepUpdates = trace.steps
        .filter(s => s.status === 'pending')
        .map(s => ({
          actionId: s.actionId,
          status: 'failed' as const,
          reasoning: `trace failed: ${reason}`,
        }));

      store.removePending(pending.actionId);

      store.appendLog({
        ts: new Date().toISOString(),
        traceId: pending.traceId,
        spanId: resolveSpan.id,
        actionId: pending.actionId,
        step: 'resolve',
        action: 'fail',
        summary: `trace: ${trace.summary} — failed: ${reason}`,
      });

      return {
        spanId: resolveSpan.id,
        terminal: true,
        enqueuedActions: [],
        reasoning: `fail: ${reason}`,
        traceMutations: {
          stepUpdates,
        },
      };
    }
  }
}

export const resolverStep: Step = {
  config: {
    actionType: 'resolve',
    maxParallel: 3,
    dedupBy: 'traceId',
  } satisfies StepConfig,

  dependencies: {
    needsProjectManager: true,
  } satisfies StepDependencies,

  async process(pending: PendingAction, ctx: StepContext): Promise<StepResult> {
    const { store, projectId, project, projectPath, trace } = ctx;

    // Git commit failed — noop (log and drop, trace ends here)
    if (pending.meta?.commitError) {
      const errorInfo = pending.meta.commitError;

      const resolveSpan = new SpanWriter(projectId, {
        step: 'resolve',
        parentId: pending.spanId,
        meta: {
          decision: 'noop',
          reason: `git commit failed: ${errorInfo.message}`,
          commitError: errorInfo,
        },
      });
      resolveSpan.fail(`resolve: commit error on trace: ${trace.summary}`);

      store.removePending(pending.actionId);

      store.appendLog({
        ts: new Date().toISOString(),
        traceId: pending.traceId,
        spanId: resolveSpan.id,
        actionId: pending.actionId,
        step: 'resolve',
        action: 'noop',
        summary: `trace: ${trace.summary} — commit failed: ${errorInfo.message} (noop)`,
      });

      return {
        spanId: resolveSpan.id,
        terminal: true,
        enqueuedActions: [],
        reasoning: `fail: git commit failed: ${errorInfo.message}`,
        status: 'failed',
      };
    }

    // Try deterministic paths first
    const quick = tryQuickDecision(trace);

    if (quick) {
      return executeDecision(
        quick.decision,
        quick.reason,
        undefined,
        pending,
        trace,
        ctx
      );
    }

    // Ambiguous state — ask the AI agent
    const aiResult = await askAIForDecision(trace, pending, ctx);

    return executeDecision(
      aiResult.decision,
      aiResult.reason,
      aiResult.iterateInstructions,
      pending,
      trace,
      ctx
    );
  },
};
