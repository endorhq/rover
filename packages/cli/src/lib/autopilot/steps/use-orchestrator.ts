import { useState, useEffect, useRef, useCallback } from 'react';
import type { ProjectManager } from 'rover-core';
import type { ActionTrace } from '../types.js';
import { AutopilotStore } from '../store.js';
import { getRepoInfo } from '../helpers.js';
import { StepOrchestrator } from './orchestrator.js';
import { coordinatorStep } from './coordinator.js';
import { plannerStep } from './planner.js';
import { workflowStep } from './workflow.js';
import { committerStep } from './committer.js';
import { resolverStep } from './resolver.js';
import type { OrchestratorCallbacks } from './types.js';

export type StepStatus = 'idle' | 'processing' | 'error';

export interface StepStatuses {
  coordinator: { status: StepStatus; processedCount: number };
  planner: { status: StepStatus; processedCount: number };
  workflow: { status: StepStatus; processedCount: number };
  committer: { status: StepStatus; processedCount: number };
  resolver: { status: StepStatus; processedCount: number };
}

const ACTION_TYPE_TO_KEY: Record<string, keyof StepStatuses> = {
  coordinate: 'coordinator',
  plan: 'planner',
  workflow: 'workflow',
  commit: 'committer',
  resolve: 'resolver',
};

const DEFAULT_STATUSES: StepStatuses = {
  coordinator: { status: 'idle', processedCount: 0 },
  planner: { status: 'idle', processedCount: 0 },
  workflow: { status: 'idle', processedCount: 0 },
  committer: { status: 'idle', processedCount: 0 },
  resolver: { status: 'idle', processedCount: 0 },
};

export function useStepOrchestrator(
  project: ProjectManager,
  projectPath: string,
  projectId: string
): {
  statuses: StepStatuses;
  traces: ActionTrace[];
  tracesRef: React.MutableRefObject<Map<string, ActionTrace>>;
  store: AutopilotStore;
} {
  // Store initialization
  const storeRef = useRef<AutopilotStore | null>(null);
  if (!storeRef.current) {
    const store = new AutopilotStore(projectId);
    store.ensureDir();
    storeRef.current = store;
  }

  // Load persisted traces
  const tracesRef = useRef<Map<string, ActionTrace>>(
    storeRef.current!.loadTraces()
  );
  const [tracesVersion, setTracesVersion] = useState(0);
  const [statuses, setStatuses] = useState<StepStatuses>(DEFAULT_STATUSES);

  // Callbacks
  const onTracesUpdated = useCallback(() => {
    setTracesVersion(v => v + 1);
    storeRef.current?.saveTraces(tracesRef.current);
  }, []);

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
    const store = storeRef.current!;
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
  }, [project, projectPath, projectId, onTracesUpdated, onStatusChanged]);

  // Derive traces array from version counter
  const traces = Array.from(tracesRef.current.values());
  // Touch tracesVersion to satisfy the linter / ensure re-renders
  void tracesVersion;

  return {
    statuses,
    traces,
    tracesRef,
    store: storeRef.current!,
  };
}
