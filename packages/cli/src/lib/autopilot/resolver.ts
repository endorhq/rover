import { useState, useEffect, useRef, useCallback } from 'react';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { IterationManager, type ProjectManager } from 'rover-core';
import { getUserAIAgent, getAIAgentTool } from '../agents/index.js';
import { parseJsonResponse } from '../../utils/json-parser.js';
import { AutopilotStore } from './store.js';
import { SpanWriter, ActionWriter, enqueueAction } from './logging.js';
import resolvePromptTemplate from './resolve-prompt.md';
import type {
  ResolverStatus,
  ResolverDecision,
  ResolverAIResult,
  ActionTrace,
  PendingAction,
  Span,
} from './types.js';

const PROCESS_INTERVAL_MS = 30_000; // 30 seconds
const INITIAL_DELAY_MS = 25_000; // 25 seconds (staggered after committer's 20s)
const MAX_RETRIES = 3;

// ── Deterministic decision paths ─────────────────────────────────────────────
// Only handles unambiguous states. Returns null when the situation needs AI
// judgment (failures, empty worktrees, ambiguous outcomes).

type QuickDecision = {
  decision: ResolverDecision;
  reason: string;
} | null;

function tryQuickDecision(trace: ActionTrace): QuickDecision {
  const steps = trace.steps;

  // Workflow steps still running or pending → wait (unambiguous)
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

  // Commit steps still active → wait (unambiguous)
  const hasActiveCommit = steps.some(
    s =>
      s.action === 'commit' &&
      (s.status === 'pending' || s.status === 'running')
  );
  if (hasActiveCommit) {
    return { decision: 'wait', reason: 'commit steps still active' };
  }

  // All commit steps completed, no failures → push (unambiguous)
  const commitSteps = steps.filter(s => s.action === 'commit');
  const failedSteps = steps.filter(
    s => s.status === 'failed' && s.action !== 'resolve' && s.action !== 'push'
  );
  const allCommitsCompleted =
    commitSteps.length > 0 && commitSteps.every(s => s.status === 'completed');

  if (allCommitsCompleted && failedSteps.length === 0) {
    return { decision: 'push', reason: 'all commits completed' };
  }

  // Max retries exceeded → fail (hard gate, no point asking AI)
  if (failedSteps.length > 0) {
    const retryCount = trace.retryCount ?? 0;
    if (retryCount >= MAX_RETRIES) {
      return {
        decision: 'fail',
        reason: `max retries (${MAX_RETRIES}) exceeded`,
      };
    }
  }

  // Failures present but retries remain, or other ambiguous state → needs AI
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
  project: ProjectManager,
  projectPath: string,
  store: AutopilotStore
): Promise<{
  decision: 'iterate' | 'fail';
  reason: string;
  iterateInstructions?: string;
}> {
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

    // Try to get task context from mapping
    const mapping = store.getTaskMapping(step.actionId);
    if (mapping) {
      const task = project.getTask(mapping.taskId);
      if (task) {
        detail.task_title = task.title;
        detail.task_description = task.description;
        detail.task_status = task.status;
        detail.error = task.error ?? null;
      }
    }

    // Check commit meta for additional context
    if (pending.meta?.committed !== undefined) {
      detail.committed = pending.meta.committed;
    }
    if (pending.meta?.taskStatus) {
      detail.task_status = pending.meta.taskStatus;
    }

    failedStepDetails.push(detail);
  }

  // Reconstruct span trace for full pipeline context
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

  // Validate decision
  if (result.decision !== 'iterate' && result.decision !== 'fail') {
    // Fallback: treat unexpected decisions as iterate if retries remain
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

// ── Process resolve action ───────────────────────────────────────────────────

async function processResolveAction(
  pending: PendingAction,
  project: ProjectManager,
  projectPath: string,
  projectId: string,
  tracesRef: React.MutableRefObject<Map<string, ActionTrace>>,
  store: AutopilotStore,
  onTracesUpdated: () => void
): Promise<{ decision: ResolverDecision; reason: string }> {
  const trace = tracesRef.current.get(pending.traceId);
  if (!trace) {
    throw new Error(`Trace ${pending.traceId} not found`);
  }

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
      decision: 'fail',
      reason: `git commit failed: ${errorInfo.message}`,
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
      project,
      projectPath,
      projectId,
      tracesRef,
      store,
      onTracesUpdated
    );
  }

  // Ambiguous state — ask the AI agent
  const aiResult = await askAIForDecision(
    trace,
    pending,
    project,
    projectPath,
    store
  );

  return executeDecision(
    aiResult.decision,
    aiResult.reason,
    aiResult.iterateInstructions,
    pending,
    trace,
    project,
    projectPath,
    projectId,
    tracesRef,
    store,
    onTracesUpdated
  );
}

async function executeDecision(
  decision: ResolverDecision,
  reason: string,
  iterateInstructions: string | undefined,
  pending: PendingAction,
  trace: ActionTrace,
  project: ProjectManager,
  projectPath: string,
  projectId: string,
  tracesRef: React.MutableRefObject<Map<string, ActionTrace>>,
  store: AutopilotStore,
  onTracesUpdated: () => void
): Promise<{ decision: ResolverDecision; reason: string }> {
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
      break;
    }

    case 'push': {
      // 1. Write resolver's own span (what we decided)
      const resolveSpan = new SpanWriter(projectId, {
        step: 'resolve',
        parentId: pending.spanId,
        meta: { decision: 'push', reason },
      });
      resolveSpan.complete(`resolve: trace ready to push: ${trace.summary}`);

      // 2. Write push action and enqueue
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

      trace.steps.push({
        actionId: pushAction.id,
        action: 'push',
        status: 'pending',
        timestamp: new Date().toISOString(),
        reasoning: 'all commits completed',
      });

      tracesRef.current.set(pending.traceId, trace);
      onTracesUpdated();
      store.removePending(pending.actionId);
      break;
    }

    case 'iterate': {
      // Find the failed task to iterate on
      const failedWorkflowStep = trace.steps.find(
        s =>
          s.status === 'failed' &&
          s.action !== 'commit' &&
          s.action !== 'resolve' &&
          s.action !== 'push'
      );

      // Resolve the action ID — prefer workflow step, fall back to commit step
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
        return { decision: 'fail', reason: 'no task mapping for failed step' };
      }

      const task = project.getTask(mapping.taskId);
      if (!task) {
        store.removePending(pending.actionId);
        return {
          decision: 'fail',
          reason: `task #${mapping.taskId} not found`,
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

      // 1. Write resolver's own span (what we decided)
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

      // 2. Write workflow action and enqueue (same shape as planner's workflow actions)
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

      trace.steps.push({
        actionId: workflowAction.id,
        action: workflowName,
        status: 'pending',
        timestamp: new Date().toISOString(),
        reasoning: `retry #${trace.retryCount}: ${task.title}`,
      });

      tracesRef.current.set(pending.traceId, trace);
      onTracesUpdated();
      store.removePending(pending.actionId);
      break;
    }

    case 'fail': {
      // Write resolver's own span (terminal — no next action)
      const resolveSpan = new SpanWriter(projectId, {
        step: 'resolve',
        parentId: pending.spanId,
        meta: { decision: 'fail', reason },
      });
      resolveSpan.fail(`resolve: trace failed: ${trace.summary}`);

      for (const step of trace.steps) {
        if (step.status === 'pending') {
          step.status = 'failed';
          step.reasoning = `trace failed: ${reason}`;
        }
      }

      tracesRef.current.set(pending.traceId, trace);
      onTracesUpdated();
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
      break;
    }
  }

  return { decision, reason };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useResolver(
  project: ProjectManager,
  projectPath: string,
  projectId: string,
  tracesRef: React.MutableRefObject<Map<string, ActionTrace>>,
  onTracesUpdated: () => void
): { status: ResolverStatus; processedCount: number } {
  const [status, setStatus] = useState<ResolverStatus>('idle');
  const [processedCount, setProcessedCount] = useState(0);
  const inProgressRef = useRef<Set<string>>(new Set());
  const storeRef = useRef<AutopilotStore | null>(null);

  if (!storeRef.current) {
    const store = new AutopilotStore(projectId);
    store.ensureDir();
    storeRef.current = store;
  }

  const doProcess = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;

    const pending = store.getPending();
    const resolveActions = pending.filter(
      p => p.action === 'resolve' && !inProgressRef.current.has(p.actionId)
    );

    if (resolveActions.length === 0) return;

    setStatus('processing');

    // De-duplicate: keep only one resolve action per traceId
    const seenTraces = new Set<string>();
    const deduped: PendingAction[] = [];
    const toRemove: string[] = [];

    for (const action of resolveActions) {
      if (seenTraces.has(action.traceId)) {
        toRemove.push(action.actionId);
      } else {
        seenTraces.add(action.traceId);
        deduped.push(action);
      }
    }

    for (const actionId of toRemove) {
      store.removePending(actionId);
    }

    for (const action of deduped) {
      inProgressRef.current.add(action.actionId);
    }

    const results = await Promise.allSettled(
      deduped.map(async action => {
        try {
          const trace = tracesRef.current.get(action.traceId);
          if (trace) {
            const existingStep = trace.steps.find(
              s => s.actionId === action.actionId
            );
            if (existingStep) {
              existingStep.status = 'running';
            }
            tracesRef.current.set(action.traceId, trace);
            onTracesUpdated();
          }

          const result = await processResolveAction(
            action,
            project,
            projectPath,
            projectId,
            tracesRef,
            store,
            onTracesUpdated
          );

          const updatedTrace = tracesRef.current.get(action.traceId);
          if (updatedTrace) {
            const step = updatedTrace.steps.find(
              s => s.actionId === action.actionId
            );
            if (step) {
              step.status = 'completed';
              step.reasoning = `${result.decision}: ${result.reason}`;
            }
            tracesRef.current.set(action.traceId, updatedTrace);
            onTracesUpdated();
          }

          setProcessedCount(c => c + 1);
        } catch (err) {
          const trace = tracesRef.current.get(action.traceId);
          if (trace) {
            const step = trace.steps.find(s => s.actionId === action.actionId);
            if (step) {
              step.status = 'failed';
              step.reasoning = err instanceof Error ? err.message : String(err);
            }
            tracesRef.current.set(action.traceId, trace);
            onTracesUpdated();
          }

          store.removePending(action.actionId);
        } finally {
          inProgressRef.current.delete(action.actionId);
        }
      })
    );

    const hasError = results.some(r => r.status === 'rejected');
    setStatus(hasError ? 'error' : 'idle');
  }, [project, projectPath, projectId, tracesRef, onTracesUpdated]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const initialTimer = setTimeout(() => {
      doProcess();
      interval = setInterval(doProcess, PROCESS_INTERVAL_MS);
    }, INITIAL_DELAY_MS);

    return () => {
      clearTimeout(initialTimer);
      if (interval) clearInterval(interval);
    };
  }, [doProcess]);

  return { status, processedCount };
}
