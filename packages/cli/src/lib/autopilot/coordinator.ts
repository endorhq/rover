import React, { useState, useEffect, useRef, useCallback } from 'react';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getDataDir } from 'rover-core';
import { getUserAIAgent, getAIAgentTool } from '../agents/index.js';
import { parseJsonResponse } from '../../utils/json-parser.js';
import { AutopilotStore } from './store.js';
import { fetchContextForAction } from './context.js';
import { getRepoInfo } from './helpers.js';
import pilotPromptTemplate from './pilot-prompt.md';
import type {
  CoordinatorStatus,
  ActionTrace,
  ActionStep,
  PendingAction,
  PilotDecision,
  Span,
  Action,
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

function writeCoordinatorSpan(
  projectId: string,
  summary: string,
  parentSpanId: string,
  decision: PilotDecision
): { spanId: string; actionId: string | null } {
  const basePath = join(getDataDir(), 'projects', projectId);
  const spansDir = join(basePath, 'spans');
  const actionsDir = join(basePath, 'actions');

  mkdirSync(spansDir, { recursive: true });
  mkdirSync(actionsDir, { recursive: true });

  const spanId = randomUUID();
  const timestamp = new Date().toISOString();

  const span: Span = {
    id: spanId,
    version: '1.0',
    timestamp,
    summary: `coordinate: ${decision.action} — ${summary}`,
    step: 'coordinate',
    parent: parentSpanId,
    meta: decision.meta,
  };

  writeFileSync(
    join(spansDir, `${spanId}.json`),
    JSON.stringify(span, null, 2)
  );

  // Noop is terminal — write span only, no action.
  if (decision.action === 'noop') {
    return { spanId, actionId: null };
  }

  const actionId = randomUUID();

  const action: Action = {
    id: actionId,
    version: '1.0',
    action: decision.action,
    timestamp,
    spanId,
    meta: decision.meta,
    reasoning: decision.reasoning,
  };

  writeFileSync(
    join(actionsDir, `${actionId}.json`),
    JSON.stringify(action, null, 2)
  );

  return { spanId, actionId };
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

  // Write span and action
  const { spanId: newSpanId, actionId: newActionId } = writeCoordinatorSpan(
    projectId,
    pending.summary,
    pending.spanId,
    decision
  );

  // If not noop, add follow-up pending action
  if (decision.action !== 'noop' && newActionId) {
    store.addPending({
      traceId: pending.traceId,
      actionId: newActionId,
      spanId: newSpanId,
      action: decision.action,
      summary: `${decision.action}: ${pending.summary}`,
      createdAt: new Date().toISOString(),
      meta: decision.meta,
    });
  }

  // Remove the processed coordinate action
  store.removePending(pending.actionId);

  // Write log entry
  store.appendLog({
    ts: new Date().toISOString(),
    traceId: pending.traceId,
    spanId: newSpanId,
    actionId: newActionId ?? '',
    step: 'coordinate',
    action: decision.action,
    summary: `${decision.action} (${decision.confidence}): ${pending.summary}`,
  });

  return { decision, newActionId, newSpanId };
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
