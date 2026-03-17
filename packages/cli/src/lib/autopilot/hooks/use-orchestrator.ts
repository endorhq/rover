import { useState, useEffect, useRef, useCallback } from 'react';
import { WorkflowStore } from 'rover-core';
import { AutopilotStore } from '../store.js';
import { MemoryStore } from '../memory/store.js';
import { StepOrchestrator } from '../steps/orchestrator.js';
import type { TraceItem } from '../types.js';
import type { Step, StepStatus } from '../steps/types.js';

export interface StepStatuses {
  [actionType: string]: {
    status: StepStatus;
    processedCount: number;
  };
}

export interface UseStepOrchestratorOptions {
  steps: Step[];
  projectId: string;
  projectPath: string;
  owner?: string;
  repo?: string;
  project?: string;
  botName?: string;
  maintainers?: string[];
  customInstructions?: string;
  mode?: string;
  fallbackIntervalMs?: number;
}

export interface UseStepOrchestratorResult {
  statuses: StepStatuses;
  traces: Map<string, TraceItem>;
  tracesRef: React.MutableRefObject<Map<string, TraceItem>>;
  requestDrain: () => void;
}

export function useStepOrchestrator(
  opts: UseStepOrchestratorOptions
): UseStepOrchestratorResult {
  const [statuses, setStatuses] = useState<StepStatuses>(() => {
    const initial: StepStatuses = {};
    for (const step of opts.steps) {
      initial[step.config.actionType] = {
        status: 'idle',
        processedCount: 0,
      };
    }
    return initial;
  });

  const [tracesVersion, setTracesVersion] = useState(0);
  const tracesRef = useRef<Map<string, TraceItem>>(new Map());
  const orchestratorRef = useRef<StepOrchestrator | null>(null);

  const requestDrain = useCallback(() => {
    orchestratorRef.current?.requestDrain();
  }, []);

  useEffect(() => {
    const store = new AutopilotStore(opts.projectId);
    store.ensureDir();

    const workflowStore = new WorkflowStore();
    const memoryStore = new MemoryStore(
      opts.projectPath,
      `autopilot-${opts.projectId}`
    );

    // Load persisted traces
    tracesRef.current = store.loadTraces();

    const orchestrator = new StepOrchestrator({
      steps: opts.steps,
      store,
      traces: tracesRef.current,
      projectId: opts.projectId,
      projectPath: opts.projectPath,
      owner: opts.owner,
      repo: opts.repo,
      project: opts.project,
      workflowStore,
      memoryStore,
      botName: opts.botName,
      maintainers: opts.maintainers,
      customInstructions: opts.customInstructions,
      mode: opts.mode,
      fallbackIntervalMs: opts.fallbackIntervalMs,
      callbacks: {
        onTracesUpdated() {
          store.saveTraces(tracesRef.current);
          setTracesVersion(v => v + 1);
        },
        onStatusChanged(actionType: string, status: StepStatus) {
          setStatuses(prev => {
            const current = prev[actionType];
            const processedCount = orchestrator.getProcessedCount(actionType);

            if (
              current &&
              current.status === status &&
              current.processedCount === processedCount
            ) {
              return prev;
            }

            return {
              ...prev,
              [actionType]: { status, processedCount },
            };
          });
        },
      },
    });

    orchestratorRef.current = orchestrator;
    orchestrator.start();

    return () => {
      orchestrator.stop();
      orchestratorRef.current = null;
    };
  }, [
    opts.projectId,
    opts.projectPath,
    opts.steps,
    opts.owner,
    opts.repo,
    opts.project,
    opts.botName,
    opts.maintainers,
    opts.customInstructions,
    opts.mode,
    opts.fallbackIntervalMs,
  ]);

  // Derive traces from version counter to trigger re-renders
  const traces = tracesRef.current;
  // tracesVersion is used to trigger re-renders when traces change
  void tracesVersion;

  return { statuses, traces, tracesRef, requestDrain };
}
