import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getUserAIAgent, getAIAgentTool } from '../agents/index.js';
import { parseJsonResponse } from '../../utils/json-parser.js';
import { AutopilotStore } from './store.js';
import { SpanWriter, ActionWriter, enqueueAction } from './logging.js';
import { fetchContextForAction } from './context.js';
import { getRepoInfo } from './helpers.js';
import pilotPromptTemplate from './pilot-prompt.md';
import type {
  CoordinatorStatus,
  ActionTrace,
  ActionStep,
  PendingAction,
  PilotDecision,
} from './types.js';

const PROCESS_INTERVAL_MS = 30_000; // 30 seconds
const INITIAL_DELAY_MS = 5_000; // 5 seconds
const MAX_PARALLEL = 3;

function buildPilotPrompt(
  meta: Record<string, any>,
  context: { type: string; data: Record<string, any> } | null
): string {
  let prompt = pilotPromptTemplate;

  prompt += '\n\n---\n\n## Event\n\n```json\n';
  prompt += JSON.stringify(meta, null, 2);
  prompt += '\n```\n';

  if (context) {
    prompt += '\n## Additional Context\n\n```json\n';
    prompt += JSON.stringify(context.data, null, 2);
    prompt += '\n```\n';
  }

  prompt += '\n## Workflows\n\nNo workflows are currently available.\n';
  prompt +=
    '\n## Constraint\n\nThe `coordinate` action is NOT available for this decision. You must choose one of the other actions.\n';

  return prompt;
}

async function processAction(
  pending: PendingAction,
  owner: string,
  repo: string,
  projectId: string,
  store: AutopilotStore
): Promise<{
  decision: PilotDecision;
  newActionId: string | null;
  newSpanId: string;
}> {
  // Open the coordinator span
  const span = new SpanWriter(projectId, {
    step: 'coordinate',
    parentId: pending.spanId,
    meta: pending.meta ?? {},
  });

  // Fetch additional context
  const context = pending.meta
    ? await fetchContextForAction(owner, repo, pending.meta)
    : null;

  // Build prompt and invoke Pilot
  const prompt = buildPilotPrompt(pending.meta ?? {}, context);
  const agent = getUserAIAgent();
  const agentTool = getAIAgentTool(agent);
  const response = await agentTool.invoke(prompt, {
    json: true,
    model: 'haiku',
  });
  const decision = parseJsonResponse<PilotDecision>(response);

  // Safety: prevent recursive coordinate
  if (decision.action === 'coordinate') {
    decision.action = 'noop';
    decision.reasoning =
      'Forced to noop: coordinate is not available as a sub-action.';
  }

  let newActionId: string | null = null;

  if (decision.action === 'noop') {
    // Noop is terminal — finalize span, no follow-up action
    span.complete(
      `coordinate: ${decision.action} — ${pending.summary}`,
      decision.meta
    );
  } else {
    // Write follow-up action and enqueue it
    const action = new ActionWriter(projectId, {
      action: decision.action,
      spanId: span.id,
      reasoning: decision.reasoning,
      meta: decision.meta,
    });
    newActionId = action.id;

    enqueueAction(store, {
      traceId: pending.traceId,
      action,
      step: 'coordinate',
      summary: `${decision.action}: ${pending.summary}`,
    });

    span.complete(
      `coordinate: ${decision.action} — ${pending.summary}`,
      decision.meta
    );
  }

  // Remove the processed coordinate action
  store.removePending(pending.actionId);

  // Write log for noop (enqueueAction already logged for non-noop)
  if (decision.action === 'noop') {
    store.appendLog({
      ts: new Date().toISOString(),
      traceId: pending.traceId,
      spanId: span.id,
      actionId: '',
      step: 'coordinate',
      action: 'noop',
      summary: `noop (${decision.confidence}): ${pending.summary}`,
    });
  }

  return { decision, newActionId, newSpanId: span.id };
}

export function useCoordinator(
  projectPath: string,
  projectId: string,
  tracesRef: React.MutableRefObject<Map<string, ActionTrace>>,
  onTracesUpdated: () => void
): {
  status: CoordinatorStatus;
  processedCount: number;
} {
  const [status, setStatus] = useState<CoordinatorStatus>('idle');
  const [processedCount, setProcessedCount] = useState(0);
  const inProgressRef = useRef<Set<string>>(new Set());
  const repoRef = useRef(getRepoInfo(projectPath));
  const storeRef = useRef<AutopilotStore | null>(null);

  if (!storeRef.current) {
    const store = new AutopilotStore(projectId);
    store.ensureDir();
    storeRef.current = store;
  }

  const doProcess = useCallback(async () => {
    const repo = repoRef.current;
    const store = storeRef.current;
    if (!repo || !store) return;

    const pending = store.getPending();
    const coordinateActions = pending.filter(
      p => p.action === 'coordinate' && !inProgressRef.current.has(p.actionId)
    );

    if (coordinateActions.length === 0) return;

    setStatus('processing');

    const available = MAX_PARALLEL - inProgressRef.current.size;
    const batch = coordinateActions.slice(0, Math.max(0, available));

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
          // Get or create trace
          const trace = tracesRef.current.get(action.traceId) ?? {
            traceId: action.traceId,
            summary: action.summary,
            steps: [],
            createdAt: action.createdAt,
          };

          // Idempotent: reuse existing step if present (e.g. after restart)
          let runningStep = trace.steps.find(
            s => s.actionId === action.actionId
          );
          if (!runningStep) {
            runningStep = {
              actionId: action.actionId,
              action: 'coordinate',
              status: 'running',
              timestamp: new Date().toISOString(),
            };
            trace.steps.push(runningStep);
          } else {
            runningStep.status = 'running';
          }
          tracesRef.current.set(action.traceId, trace);
          onTracesUpdated();

          const { decision, newActionId, newSpanId } = await processAction(
            action,
            repo.owner,
            repo.repo,
            projectId,
            store
          );

          // Update step to completed
          runningStep.status = 'completed';
          runningStep.reasoning = `${decision.action} (${decision.confidence})`;

          if (decision.action === 'noop') {
            // Noop is terminal — add a completed noop step with its span
            trace.steps.push({
              actionId: action.actionId, // reuse parent id (no action file)
              action: 'noop',
              status: 'completed',
              timestamp: new Date().toISOString(),
              reasoning: decision.reasoning,
              spanId: newSpanId,
            });
          } else if (newActionId) {
            // Add next step as pending
            trace.steps.push({
              actionId: newActionId,
              action: decision.action,
              status: 'pending',
              timestamp: new Date().toISOString(),
              reasoning: decision.reasoning,
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
  }, [projectId, onTracesUpdated]);

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
