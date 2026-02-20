import { useState, useEffect, useRef, useCallback } from 'react';
import type { ProjectManager } from 'rover-core';
import type { ActionTrace } from '../types.js';
import type { AutopilotStore } from '../store.js';
import { getRepoInfo } from '../helpers.js';
import { StepOrchestrator } from './orchestrator.js';
import { coordinatorStep } from './coordinator.js';
import { plannerStep } from './planner.js';
import { workflowStep } from './workflow.js';
import { committerStep } from './committer.js';
import { resolverStep } from './resolver.js';
import { pusherStep } from './pusher.js';
import { noopStep } from './noop.js';
import { notifyStep } from './notify.js';
import type { OrchestratorCallbacks } from './types.js';

export type StepStatus = 'idle' | 'processing' | 'error';

export interface StepStatuses {
  coordinator: { status: StepStatus; processedCount: number };
  planner: { status: StepStatus; processedCount: number };
  workflow: { status: StepStatus; processedCount: number };
  committer: { status: StepStatus; processedCount: number };
  resolver: { status: StepStatus; processedCount: number };
  pusher: { status: StepStatus; processedCount: number };
  notify: { status: StepStatus; processedCount: number };
  noop: { status: StepStatus; processedCount: number };
}

const ACTION_TYPE_TO_KEY: Record<string, keyof StepStatuses> = {
  coordinate: 'coordinator',
  plan: 'planner',
  workflow: 'workflow',
  commit: 'committer',
  resolve: 'resolver',
  push: 'pusher',
  notify: 'notify',
  noop: 'noop',
};

const DEFAULT_STATUSES: StepStatuses = {
  coordinator: { status: 'idle', processedCount: 0 },
  planner: { status: 'idle', processedCount: 0 },
  workflow: { status: 'idle', processedCount: 0 },
  committer: { status: 'idle', processedCount: 0 },
  resolver: { status: 'idle', processedCount: 0 },
  pusher: { status: 'idle', processedCount: 0 },
  notify: { status: 'idle', processedCount: 0 },
  noop: { status: 'idle', processedCount: 0 },
};

export function useStepOrchestrator(
  project: ProjectManager,
  projectPath: string,
  projectId: string,
  store: AutopilotStore
): {
  statuses: StepStatuses;
  traces: ActionTrace[];
  tracesRef: React.MutableRefObject<Map<string, ActionTrace>>;
  requestDrain: () => void;
} {
  // Load persisted traces
  const tracesRef = useRef<Map<string, ActionTrace>>(store.loadTraces());
  const [tracesVersion, setTracesVersion] = useState(0);
  const [statuses, setStatuses] = useState<StepStatuses>(DEFAULT_STATUSES);

  // Callbacks
  const onTracesUpdated = useCallback(() => {
    setTracesVersion(v => v + 1);
    store.saveTraces(tracesRef.current);
  }, [store]);

  const onStatusChanged = useCallback(
    (
      actionType: string,
      status: 'idle' | 'processing' | 'error',
      processedCount: number
    ) => {
      const key = ACTION_TYPE_TO_KEY[actionType];
      if (!key) return;

      setStatuses(prev => {
        const current = prev[key];
        if (
          current.status === status &&
          current.processedCount === processedCount
        ) {
          return prev;
        }
        return {
          ...prev,
          [key]: { status, processedCount },
        };
      });
    },
    []
  );

  // Orchestrator lifecycle
  const orchestratorRef = useRef<StepOrchestrator | null>(null);

  useEffect(() => {
    const repoInfo = getRepoInfo(projectPath);
    const callbacks: OrchestratorCallbacks = {
      onTracesUpdated,
      onStatusChanged,
    };

    const orchestrator = new StepOrchestrator({
      steps: [
        coordinatorStep,
        plannerStep,
        workflowStep,
        committerStep,
        resolverStep,
        pusherStep,
        notifyStep,
        noopStep,
      ],
      store,
      traces: tracesRef.current,
      projectId,
      projectPath,
      owner: repoInfo?.owner,
      repo: repoInfo?.repo,
      project,
      callbacks,
    });

    orchestratorRef.current = orchestrator;
    orchestrator.start();

    return () => {
      orchestrator.stop();
    };
  }, [
    project,
    projectPath,
    projectId,
    store,
    onTracesUpdated,
    onStatusChanged,
  ]);

  // Stable callback that pokes the orchestrator to drain immediately
  const requestDrain = useCallback(() => {
    orchestratorRef.current?.requestDrain();
  }, []);

  // Derive traces array from version counter
  const traces = Array.from(tracesRef.current.values());
  // Touch tracesVersion to satisfy the linter / ensure re-renders
  void tracesVersion;

  return {
    statuses,
    traces,
    tracesRef,
    requestDrain,
  };
}
