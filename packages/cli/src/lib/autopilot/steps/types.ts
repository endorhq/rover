import type { ProjectManager } from 'rover-core';
import type {
  ActionStepStatus,
  ActionStep,
  ActionTrace,
  PendingAction,
} from '../types.js';
import type { AutopilotStore } from '../store.js';

// ── Step configuration ──────────────────────────────────────────────────────

export interface StepConfig {
  /** Action type this step handles (e.g. 'coordinate', 'plan', 'workflow'). */
  actionType: string;
  /** Max concurrent actions being processed for this step. */
  maxParallel: number;
  /** Optional deduplication strategy. 'traceId' keeps one action per trace. */
  dedupBy?: 'traceId';
}

export interface StepDependencies {
  /** Step needs owner/repo info (coordinator). */
  needsOwnerRepo?: boolean;
  /** Step needs a ProjectManager instance (workflow, committer, resolver). */
  needsProjectManager?: boolean;
}

// ── Step context (provided by orchestrator to each process call) ────────────

export interface StepContext {
  store: AutopilotStore;
  projectId: string;
  projectPath: string;
  /** The trace for the pending action (get-or-created by orchestrator). */
  trace: ActionTrace;
  owner?: string;
  repo?: string;
  project?: ProjectManager;
}

// ── Step result (returned by process, applied by orchestrator) ──────────────

export interface StepResult {
  spanId: string;
  /** True = no follow-up actions (trace may end here). */
  terminal: boolean;
  /** Actions enqueued by this step (orchestrator adds them as pending trace steps). */
  enqueuedActions: Array<{
    actionId: string;
    actionType: string;
    summary: string;
  }>;
  reasoning: string;
  /**
   * Step completion status. Defaults to 'completed' if omitted.
   * 'pending' = action is not ready yet, leave it in the queue for retry.
   */
  status?: 'completed' | 'failed' | 'running' | 'pending' | 'error';
  /** Direct trace mutations (e.g. resolver marking pending steps failed). */
  traceMutations?: {
    stepUpdates?: Array<{
      actionId: string;
      status: ActionStepStatus;
      reasoning?: string;
    }>;
  };
}

// ── Trace mutations (returned by monitor) ───────────────────────────────────

export interface TraceMutations {
  updates: Array<{
    traceId: string;
    stepUpdates: Array<{
      actionId: string;
      status: ActionStepStatus;
      reasoning?: string;
    }>;
    newSteps: ActionStep[];
  }>;
}

// ── Step interface ──────────────────────────────────────────────────────────

export interface MonitorContext {
  store: AutopilotStore;
  projectId: string;
  projectPath: string;
  traces: Map<string, ActionTrace>;
  owner?: string;
  repo?: string;
  project?: ProjectManager;
}

export interface Step {
  config: StepConfig;
  dependencies: StepDependencies;
  /** Process a single pending action and return the result. */
  process(pending: PendingAction, ctx: StepContext): Promise<StepResult>;
  /** Optional monitor for two-phase steps (workflow runner). Called on each tick. */
  monitor?(ctx: MonitorContext): TraceMutations | null;
}

// ── Orchestrator callbacks ──────────────────────────────────────────────────

export interface OrchestratorCallbacks {
  /** Called after any trace update. Should bump React state and persist traces. */
  onTracesUpdated(): void;
  /** Called when a step's processing status changes. */
  onStatusChanged(
    actionType: string,
    status: 'idle' | 'processing' | 'error',
    processedCount: number
  ): void;
}
