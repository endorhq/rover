export interface TaskInfo {
  id: number;
  title: string;
  status: string;
  progress: number;
  agent: string;
  duration: string;
  iteration: number;
}

export interface LogEntry {
  timestamp: string;
  message: string;
}

export type WorkSlotStatus = 'idle' | 'running' | 'done' | 'error';

export interface WorkSlot {
  id: number;
  label: string;
  status: WorkSlotStatus;
  fill: string;
}

export type FetchStatus = 'idle' | 'fetching' | 'done' | 'error';

export interface GitHubEvent {
  id: string;
  type: string;
  actor: { login: string };
  created_at: string;
  payload: Record<string, any>;
}

export interface Trace {
  id: string;
  version: string;
  timestamp: string;
  summary: string;
  step: string;
  parent: string | null;
  meta: Record<string, any>;
}

export interface Action {
  id: string;
  version: string;
  action: string;
  timestamp: string;
  traceId: string;
  meta: Record<string, any>;
  reasoning: string;
}

export interface EventCursor {
  version: string;
  processedEventIds: string[];
  updatedAt: string;
}

export interface PendingAction {
  chainId: string;
  actionId: string;
  traceId: string;
  action: string;
  summary: string;
  createdAt: string;
  meta?: Record<string, any>;
}

export interface PilotDecision {
  action: string;
  confidence: string;
  reasoning: string;
  meta: Record<string, any>;
}

export type ActionStepStatus = 'completed' | 'running' | 'pending' | 'failed';

export interface ActionStep {
  actionId: string;
  action: string;
  status: ActionStepStatus;
  timestamp: string;
  reasoning?: string;
}

export interface ActionChain {
  chainId: string;
  summary: string;
  steps: ActionStep[];
  createdAt: string;
}

export type CoordinatorStatus = 'idle' | 'processing' | 'error';
export type PlannerStatus = 'idle' | 'processing' | 'error';
export type WorkflowRunnerStatus = 'idle' | 'processing' | 'error';
export type ViewMode = 'main' | 'actions';

export interface TaskMapping {
  taskId: number;
  branchName: string;
}

export interface PlanTask {
  title: string;
  workflow: 'swe' | 'code-review' | 'bug-finder' | 'security-analyst';
  description: string;
  acceptance_criteria: string[];
  context: {
    files: string[];
    references: string[];
    depends_on: string | null;
  };
}

export interface PlanResult {
  analysis: string;
  tasks: PlanTask[];
  execution_order: 'parallel' | 'sequential' | 'mixed';
  reasoning: string;
}

export interface AutopilotState {
  version: string;
  pending: PendingAction[];
  taskMappings?: Record<string, TaskMapping>;
  updatedAt: string;
}

export interface AutopilotLogEntry {
  ts: string;
  chainId: string;
  traceId: string;
  actionId: string;
  step: string;
  action: string;
  summary: string;
}
