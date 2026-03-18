/**
 * - `failed` — the step ran but the outcome was negative (logical failure).
 * - `error`  — unexpected/environmental failure (exception, infra issue).
 */
export type SpanStatus = 'running' | 'completed' | 'failed' | 'error';

/** A unit of execution within the pipeline. Each step creates a span that
 *  records its start time, status, result summary, and any follow-up actions. */
export interface Span {
  id: string;
  version: string;
  timestamp: string;
  step: string;
  parent: string | null;
  status?: SpanStatus;
  completed?: string | null;
  summary: string | null;
  meta: Record<string, unknown>;
  /** The action that was processed to create this span. Null for the root event span. */
  originAction: string | null;
  /** Action IDs generated during this span's execution. */
  newActions: string[];
}

/** An immutable directive telling the pipeline what to do next.
 *  Created by one step and consumed by another. */
export interface Action {
  id: string;
  version: string;
  action: string;
  timestamp: string;
  spanId: string;
  meta: Record<string, unknown>;
  reasoning: string;
}

/** An action waiting in the queue to be picked up by its target step. */
export interface PendingAction {
  traceId: string;
  actionId: string;
  /** The action type, used to route to the correct step handler. */
  action: string;
}

/** The full execution history of one event flowing through the pipeline.
 *  Groups span IDs (completed steps) and pending action IDs (next steps).
 *  All details are read from the corresponding span/action files on disk. */
export interface TraceItem {
  traceId: string;
  summary: string;
  /** Ordered span IDs representing completed execution steps. */
  spanIds: string[];
  /** Action IDs enqueued but not yet processed. */
  nextActions: string[];
  createdAt: string;
  retryCount?: number;
}

export type FetchStatus = 'idle' | 'fetching' | 'done' | 'error';

/** Tracks which event IDs have been processed to prevent duplicates.
 *  Capped at 200 entries with FIFO eviction. */
export interface EventCursor {
  version: string;
  processedEventIds: string[];
  updatedAt: string;
}

/** Links an action ID to the Rover task and git branch it created. */
export interface TaskMapping {
  taskId: number;
  branchName: string;
  traceId?: string;
  workflowSpanId?: string;
}

/** A paused action waiting for an external condition before resuming. */
export interface WaitEntry {
  traceId: string;
  actionId: string;
  spanId: string;
  waitingFor: string;
  resumeAction: string;
  resumeMeta: Record<string, unknown>;
  eventSummary: string;
  createdAt: string;
}

/** Top-level persistent state: pending queue, task mappings, and wait queue. */
export interface AutopilotState {
  version: string;
  pending: PendingAction[];
  taskMappings?: Record<string, TaskMapping>;
  waitQueue?: WaitEntry[];
  updatedAt: string;
}

/** A single row in the structured audit log (`log.jsonl`). */
export interface AutopilotLogEntry {
  ts: string;
  traceId: string;
  spanId: string;
  actionId: string;
  step: string;
  action: string;
  summary: string;
}

export type ViewMode = 'main' | 'inspector';

export interface LogEntry {
  timestamp: string;
  message: string;
}

export interface TaskInfo {
  id: number;
  title: string;
  status: string;
  progress: number;
  agent: string;
  duration: string;
  iteration: number;
}
