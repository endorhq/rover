import type { AutopilotStore } from '../store.js';
import type { TraceItem, PendingAction } from '../types.js';
import type { MemoryStore } from '../memory/store.js';
import type { ProjectManager, WorkflowStore } from 'rover-core';

/** Configuration that describes how a step behaves in the pipeline. */
export interface StepConfig {
  /** The action type this step handles (e.g. 'coordinate', 'plan'). */
  actionType: string;
  /** Maximum number of concurrent executions for this step. */
  maxParallel: number;
}

/** Declares what external dependencies a step needs injected. */
export interface StepDependencies {
  needsOwnerRepo?: boolean;
  needsProjectManager?: boolean;
}

/** Shared context fields available to all steps. */
export interface BaseContext {
  store: AutopilotStore;
  project: ProjectManager;
  owner: string | undefined;
  repo: string | undefined;
  workflowStore: WorkflowStore | undefined;
  memoryStore: MemoryStore | undefined;
  botName: string | undefined;
  maintainers: string[] | undefined;
  customInstructions: string | undefined;
  mode: string | undefined;
}

/** Context passed to a step's process function. */
export interface StepContext extends BaseContext {
  /** The action trace this action belongs to. */
  trace: TraceItem;
  /** Mark all pending siblings in this trace as failed and remove them from the queue. */
  failTrace(reason: string): void;
}

/** The result returned by a step's process function. */
export interface StepResult {
  /** The span ID created by this step's execution. */
  spanId: string;
  /** True when this step is terminal (no follow-up actions expected). */
  terminal?: boolean;
  /** Actions created by this step for downstream processing. */
  newActions?: Array<{ actionId: string; action: string }>;
  /** Override the step status (e.g. 'pending' to keep the action in queue). */
  status?: 'completed' | 'pending';
}

/** A pipeline step that processes actions of a specific type. */
export interface Step {
  config: StepConfig;
  dependencies?: StepDependencies;
  process(action: PendingAction, ctx: StepContext): Promise<StepResult>;
}

export type StepStatus = 'idle' | 'processing' | 'error';

/** Callbacks for the orchestrator to notify the UI of state changes. */
export interface OrchestratorCallbacks {
  /** Called when traces have been updated (new steps, status changes). */
  onTracesUpdated(): void;
  /** Called when a step's processing status changes. */
  onStatusChanged(actionType: string, status: StepStatus): void;
}
