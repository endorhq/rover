import { useState, useEffect, useRef, useCallback } from 'react';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getDataDir } from 'rover-core';
import { getUserAIAgent, getAIAgentTool } from '../agents/index.js';
import { parseJsonResponse } from '../../utils/json-parser.js';
import { AutopilotStore } from './store.js';
import planPromptTemplate from './plan-prompt.md';
import type {
  PlannerStatus,
  PlanResult,
  PlanTask,
  ActionTrace,
  ActionStep,
  PendingAction,
  Span,
  Action,
} from './types.js';

const PROCESS_INTERVAL_MS = 30_000; // 30 seconds
const INITIAL_DELAY_MS = 10_000; // 10 seconds
const MAX_PARALLEL = 2;

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

function writePlannerSpan(
  projectId: string,
  summary: string,
  parentSpanId: string,
  planResult: PlanResult
): { spanId: string; actionId: string } {
  const basePath = join(getDataDir(), 'projects', projectId);
  const spansDir = join(basePath, 'spans');
  const actionsDir = join(basePath, 'actions');

  mkdirSync(spansDir, { recursive: true });
  mkdirSync(actionsDir, { recursive: true });

  const spanId = randomUUID();
  const actionId = randomUUID();
  const timestamp = new Date().toISOString();

  const span: Span = {
    id: spanId,
    version: '1.0',
    timestamp,
    summary: `plan: ${summary}`,
    step: 'plan',
    parent: parentSpanId,
    meta: {
      analysis: planResult.analysis,
      taskCount: planResult.tasks.length,
      executionOrder: planResult.execution_order,
    },
  };

  const action: Action = {
    id: actionId,
    version: '1.0',
    action: 'plan',
    timestamp,
    spanId,
    meta: {
      taskCount: planResult.tasks.length,
      executionOrder: planResult.execution_order,
    },
    reasoning: planResult.reasoning,
  };

  writeFileSync(
    join(spansDir, `${spanId}.json`),
    JSON.stringify(span, null, 2)
  );
  writeFileSync(
    join(actionsDir, `${actionId}.json`),
    JSON.stringify(action, null, 2)
  );

  return { spanId, actionId };
}

function writeWorkflowActions(
  projectId: string,
  sourcePending: PendingAction,
  planResult: PlanResult,
  planSpanId: string,
  store: AutopilotStore
): Array<{ task: PlanTask; actionId: string }> {
  const basePath = join(getDataDir(), 'projects', projectId);
  const actionsDir = join(basePath, 'actions');
  mkdirSync(actionsDir, { recursive: true });

  // First pass: generate actionIds and build title → actionId map
  const taskEntries: Array<{ task: PlanTask; actionId: string }> = [];
  const titleToActionId = new Map<string, string>();

  for (const task of planResult.tasks) {
    const actionId = randomUUID();
    taskEntries.push({ task, actionId });
    titleToActionId.set(task.title, actionId);
  }

  // Second pass: write Action file, enqueue PendingAction, and log per task
  for (const { task, actionId } of taskEntries) {
    const dependsOnActionId = task.context.depends_on
      ? (titleToActionId.get(task.context.depends_on) ?? null)
      : null;

    const timestamp = new Date().toISOString();
    const description =
      task.description.length > 200
        ? task.description.slice(0, 200) + '…'
        : task.description;

    // Write Action JSON file
    const action: Action = {
      id: actionId,
      version: '1.0',
      action: 'workflow',
      timestamp,
      spanId: planSpanId,
      meta: {
        workflow: task.workflow,
        title: task.title,
        description: task.description,
        acceptance_criteria: task.acceptance_criteria,
        context: task.context,
        depends_on_action_id: dependsOnActionId,
      },
      reasoning: `${task.title}: ${description}`,
    };

    writeFileSync(
      join(actionsDir, `${actionId}.json`),
      JSON.stringify(action, null, 2)
    );

    // Enqueue PendingAction
    store.addPending({
      traceId: sourcePending.traceId,
      actionId,
      spanId: planSpanId,
      action: 'workflow',
      summary: `${task.workflow}: ${task.title}`,
      createdAt: timestamp,
      meta: {
        workflow: task.workflow,
        title: task.title,
        description: task.description,
        acceptance_criteria: task.acceptance_criteria,
        context: task.context,
        depends_on_action_id: dependsOnActionId,
      },
    });

    // Write log entry per task
    store.appendLog({
      ts: timestamp,
      traceId: sourcePending.traceId,
      spanId: planSpanId,
      actionId,
      step: 'plan',
      action: 'workflow',
      summary: `${task.workflow}: ${task.title}`,
    });
  }

  return taskEntries;
}

async function processPlanAction(
  pending: PendingAction,
  projectPath: string,
  projectId: string,
  store: AutopilotStore
): Promise<{
  planResult: PlanResult;
  planSpanId: string;
  taskEntries: Array<{ task: PlanTask; actionId: string }>;
}> {
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

  // Write plan span
  const { spanId: planSpanId } = writePlannerSpan(
    projectId,
    pending.summary,
    pending.spanId,
    planResult
  );

  // Write workflow action files, enqueue pending actions, and log per task
  const taskEntries = writeWorkflowActions(
    projectId,
    pending,
    planResult,
    planSpanId,
    store
  );

  // Remove processed plan action from pending
  store.removePending(pending.actionId);

  return { planResult, planSpanId, taskEntries };
}

export function usePlanner(
  projectPath: string,
  projectId: string,
  tracesRef: React.MutableRefObject<Map<string, ActionTrace>>,
  onTracesUpdated: () => void
): {
  status: PlannerStatus;
  processedCount: number;
} {
  const [status, setStatus] = useState<PlannerStatus>('idle');
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
    const planActions = pending.filter(
      p => p.action === 'plan' && !inProgressRef.current.has(p.actionId)
    );

    if (planActions.length === 0) return;

    setStatus('processing');

    const available = MAX_PARALLEL - inProgressRef.current.size;
    const batch = planActions.slice(0, Math.max(0, available));

    if (batch.length === 0) {
      setStatus('idle');
      return;
    }

    // Mark as in-progress
    for (const action of batch) {
      inProgressRef.current.add(action.actionId);
    }

    const results = await Promise.allSettled(
      batch.map(async action => {
        try {
          // Find/create the trace
          const trace = tracesRef.current.get(action.traceId) ?? {
            traceId: action.traceId,
            summary: action.summary,
            steps: [],
            createdAt: action.createdAt,
          };

          // Mark plan step as running (find existing pending step or add new)
          let runningStep = trace.steps.find(
            s => s.actionId === action.actionId
          );
          if (runningStep) {
            runningStep.status = 'running';
          } else {
            runningStep = {
              actionId: action.actionId,
              action: 'plan',
              status: 'running',
              timestamp: new Date().toISOString(),
            };
            trace.steps.push(runningStep);
          }
          tracesRef.current.set(action.traceId, trace);
          onTracesUpdated();

          const { planResult, taskEntries } = await processPlanAction(
            action,
            projectPath,
            projectId,
            store
          );

          // Mark plan step as completed
          runningStep.status = 'completed';
          runningStep.reasoning = `${planResult.tasks.length} task(s), ${planResult.execution_order}`;

          // Add one pending step per workflow task using real actionIds
          for (const { task, actionId } of taskEntries) {
            trace.steps.push({
              actionId,
              action: task.workflow,
              status: 'pending',
              timestamp: new Date().toISOString(),
              reasoning: task.title,
            });
          }

          tracesRef.current.set(action.traceId, trace);
          onTracesUpdated();
          setProcessedCount(c => c + 1);
        } catch {
          // Mark step as failed in the trace
          const trace = tracesRef.current.get(action.traceId);
          if (trace) {
            const step = trace.steps.find(s => s.actionId === action.actionId);
            if (step) {
              step.status = 'failed';
            }
            tracesRef.current.set(action.traceId, trace);
            onTracesUpdated();
          }

          // Remove from pending on failure too
          store.removePending(action.actionId);
        } finally {
          inProgressRef.current.delete(action.actionId);
        }
      })
    );

    // Check if any failed
    const hasError = results.some(r => r.status === 'rejected');
    setStatus(hasError ? 'error' : 'idle');
  }, [projectPath, projectId, tracesRef, onTracesUpdated]);

  // Initial delay then periodic processing
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
