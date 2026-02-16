import { useState, useEffect, useRef, useCallback } from 'react';
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
  ActionChain,
  ActionStep,
  PendingAction,
  PilotDecision,
  Trace,
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

function writeCoordinatorTrace(
  projectId: string,
  summary: string,
  parentTraceId: string,
  decision: PilotDecision
): { traceId: string; actionId: string } {
  const basePath = join(getDataDir(), 'projects', projectId);
  const tracesDir = join(basePath, 'traces');
  const actionsDir = join(basePath, 'actions');

  mkdirSync(tracesDir, { recursive: true });
  mkdirSync(actionsDir, { recursive: true });

  const traceId = randomUUID();
  const actionId = randomUUID();
  const timestamp = new Date().toISOString();

  const trace: Trace = {
    id: traceId,
    version: '1.0',
    timestamp,
    summary: `coordinate: ${decision.action} — ${summary}`,
    step: 'coordinate',
    parent: parentTraceId,
    meta: decision.meta,
  };

  const action: Action = {
    id: actionId,
    version: '1.0',
    action: decision.action,
    timestamp,
    traceId,
    meta: decision.meta,
    reasoning: decision.reasoning,
  };

  writeFileSync(
    join(tracesDir, `${traceId}.json`),
    JSON.stringify(trace, null, 2)
  );
  writeFileSync(
    join(actionsDir, `${actionId}.json`),
    JSON.stringify(action, null, 2)
  );

  return { traceId, actionId };
}

async function processAction(
  pending: PendingAction,
  owner: string,
  repo: string,
  projectId: string,
  store: AutopilotStore
): Promise<{
  decision: PilotDecision;
  newActionId: string;
  newTraceId: string;
}> {
  // Fetch additional context
  const context = pending.meta
    ? await fetchContextForAction(owner, repo, pending.meta)
    : null;

  // Build prompt and invoke Pilot
  const prompt = buildPilotPrompt(pending.meta ?? {}, context);
  const agent = getUserAIAgent();
  const agentTool = getAIAgentTool(agent);
  const response = await agentTool.invoke(prompt, true);
  const decision = parseJsonResponse<PilotDecision>(response);

  // Safety: prevent recursive coordinate
  if (decision.action === 'coordinate') {
    decision.action = 'noop';
    decision.reasoning =
      'Forced to noop: coordinate is not available as a sub-action.';
  }

  // Write trace and action
  const { traceId: newTraceId, actionId: newActionId } = writeCoordinatorTrace(
    projectId,
    pending.summary,
    pending.traceId,
    decision
  );

  // If not noop, add follow-up pending action
  if (decision.action !== 'noop') {
    store.addPending({
      chainId: pending.chainId,
      actionId: newActionId,
      traceId: newTraceId,
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
    chainId: pending.chainId,
    traceId: newTraceId,
    actionId: newActionId,
    step: 'coordinate',
    action: decision.action,
    summary: `${decision.action} (${decision.confidence}): ${pending.summary}`,
  });

  return { decision, newActionId, newTraceId };
}

export function useCoordinator(
  projectPath: string,
  projectId: string
): {
  status: CoordinatorStatus;
  chains: ActionChain[];
  processedCount: number;
} {
  const [status, setStatus] = useState<CoordinatorStatus>('idle');
  const [chainsVersion, setChainsVersion] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const chainsRef = useRef<Map<string, ActionChain>>(new Map());
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
          // Add initial step to chain
          const chain = chainsRef.current.get(action.chainId) ?? {
            chainId: action.chainId,
            summary: action.summary,
            steps: [],
            createdAt: action.createdAt,
          };

          // Mark coordinate step as running
          const runningStep: ActionStep = {
            actionId: action.actionId,
            action: 'coordinate',
            status: 'running',
            timestamp: new Date().toISOString(),
          };
          chain.steps.push(runningStep);
          chainsRef.current.set(action.chainId, chain);
          setChainsVersion(v => v + 1);

          const { decision, newActionId } = await processAction(
            action,
            repo.owner,
            repo.repo,
            projectId,
            store
          );

          // Update step to completed
          runningStep.status = 'completed';
          runningStep.reasoning = `${decision.action} (${decision.confidence})`;

          // Add next step as pending (if not noop)
          if (decision.action !== 'noop') {
            chain.steps.push({
              actionId: newActionId,
              action: decision.action,
              status: 'pending',
              timestamp: new Date().toISOString(),
              reasoning: decision.reasoning,
            });
          }

          chainsRef.current.set(action.chainId, chain);
          setChainsVersion(v => v + 1);
          setProcessedCount(c => c + 1);
        } catch {
          // Mark step as failed in the chain
          const chain = chainsRef.current.get(action.chainId);
          if (chain) {
            const step = chain.steps.find(s => s.actionId === action.actionId);
            if (step) {
              step.status = 'failed';
            }
            chainsRef.current.set(action.chainId, chain);
            setChainsVersion(v => v + 1);
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
  }, [projectId]);

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

  const chains = Array.from(chainsRef.current.values());

  return { status, chains, processedCount };
}
