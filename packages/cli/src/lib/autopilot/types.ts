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

export type SpanStatus = 'running' | 'completed' | 'failed' | 'error';

export interface Span {
  id: string;
  version: string;
  timestamp: string;
  step: string;
  parent: string | null;
  status?: SpanStatus;
  completed?: string | null;
  summary: string | null;
  meta: Record<string, any>;
}

export interface Action {
  id: string;
  version: string;
  action: string;
  timestamp: string;
  spanId: string;
  meta: Record<string, any>;
  reasoning: string;
}

export interface EventCursor {
  version: string;
  processedEventIds: string[];
  updatedAt: string;
}

export interface PendingAction {
  traceId: string;
  actionId: string;
  spanId: string;
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
  /** For span-only steps (e.g. noop) that have no follow-up action. */
  spanId?: string;
}

export interface ActionTrace {
  traceId: string;
  summary: string;
  steps: ActionStep[];
  createdAt: string;
  retryCount?: number;
}

export type CoordinatorStatus = 'idle' | 'processing' | 'error';
export type PlannerStatus = 'idle' | 'processing' | 'error';
export type WorkflowRunnerStatus = 'idle' | 'processing' | 'error';
export type CommitterStatus = 'idle' | 'processing' | 'error';
export type ResolverStatus = 'idle' | 'processing' | 'error';
export type ResolverDecision = 'wait' | 'push' | 'iterate' | 'fail';

export interface ResolverAIResult {
  decision: 'iterate' | 'fail';
  reasoning: string;
  iterate_instructions?: string;
  fail_reason?: string;
}

export interface CommitterAIResult {
  status: 'committed' | 'no_changes' | 'failed';
  commit_sha: string | null;
  commit_message: string | null;
  error: string | null;
  recovery_actions_taken: string[];
  summary: string;
}
export type ViewMode = 'main' | 'inspector';

export interface TaskMapping {
  taskId: number;
  branchName: string;
  traceId?: string;
  workflowSpanId?: string;
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
  traceId: string;
  spanId: string;
  actionId: string;
  step: string;
  action: string;
  summary: string;
}
