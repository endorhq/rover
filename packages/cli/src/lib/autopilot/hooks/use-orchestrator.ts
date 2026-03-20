import { useState, useEffect, useRef, useCallback } from 'react';
import { type ProjectManager, WorkflowStore } from 'rover-core';
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
  project: ProjectManager;
  owner?: string;
  repo?: string;
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
    const store = new AutopilotStore(opts.project.id);
    store.ensureDir();

    const workflowStore = new WorkflowStore();
    const memoryStore = new MemoryStore(
      opts.project.path,
      `autopilot-${opts.project.id}`
    );

    // Load persisted traces
    tracesRef.current = store.loadTraces();

    const orchestrator = new StepOrchestrator({
      steps: opts.steps,
      store,
      traces: tracesRef.current,
      project: opts.project,
      owner: opts.owner,
      repo: opts.repo,
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
    opts.project,
    opts.steps,
    opts.owner,
    opts.repo,
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
