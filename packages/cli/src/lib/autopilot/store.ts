import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { getProjectPath } from 'rover-core';
import type {
  Action,
  TraceItem,
  AutopilotLogEntry,
  AutopilotState,
  EventCursor,
  PendingAction,
  Span,
  TaskMapping,
  WaitEntry,
} from './types.js';

const CURSOR_MAX_IDS = 200;
const LOG_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const LOG_MAX_ROTATED = 3;

function defaultCursor(): EventCursor {
  return {
    version: '1.0',
    processedEventIds: [],
    updatedAt: new Date().toISOString(),
  };
}

function defaultState(): AutopilotState {
  return {
    version: '1.0',
    pending: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Manages all autopilot persistence: event cursor, pending action queue,
 * task mappings, wait queue, trace cache, and structured audit log with rotation.
 *
 * All data lives under `~/.rover/data/projects/{projectId}/autopilot/`.
 * Spans and actions are stored one level up in `spans/` and `actions/`.
 */
export class AutopilotStore {
  private projectId: string;
  private basePath: string;
  private cursorPath: string;
  private statePath: string;
  private logPath: string;
  private tracesPath: string;

  constructor(projectId: string) {
    this.projectId = projectId;
    this.basePath = join(getProjectPath(projectId), 'autopilot');
    this.cursorPath = join(this.basePath, 'cursor.json');
    this.statePath = join(this.basePath, 'state.json');
    this.logPath = join(this.basePath, 'log.jsonl');
    this.tracesPath = join(this.basePath, 'traces.json');
  }

  /** Create the autopilot directory and initialize default files if missing. */
  ensureDir(): void {
    mkdirSync(this.basePath, { recursive: true });
    if (!existsSync(this.cursorPath)) {
      this.saveCursor(defaultCursor());
    }
    if (!existsSync(this.statePath)) {
      this.saveState(defaultState());
    }
  }

  /** Load the event cursor from disk. Returns a default cursor on read failure. */
  loadCursor(): EventCursor {
    try {
      const raw = readFileSync(this.cursorPath, 'utf8');
      return JSON.parse(raw) as EventCursor;
    } catch {
      return defaultCursor();
    }
  }

  /** Persist the event cursor. Stamps `updatedAt` automatically. */
  saveCursor(cursor: EventCursor): void {
    cursor.updatedAt = new Date().toISOString();
    writeFileSync(this.cursorPath, JSON.stringify(cursor, null, 2), 'utf8');
  }

  /** Check whether an event ID has already been processed. */
  isEventProcessed(eventId: string): boolean {
    const cursor = this.loadCursor();
    return cursor.processedEventIds.includes(eventId);
  }

  /** Mark event IDs as processed. Trims the list to the last 200 entries. */
  markEventsProcessed(eventIds: string[]): void {
    const cursor = this.loadCursor();
    cursor.processedEventIds.push(...eventIds);
    if (cursor.processedEventIds.length > CURSOR_MAX_IDS) {
      cursor.processedEventIds = cursor.processedEventIds.slice(
        -CURSOR_MAX_IDS
      );
    }
    this.saveCursor(cursor);
  }

  /** Load the autopilot state from disk. Returns a default state on failure. */
  loadState(): AutopilotState {
    try {
      const raw = readFileSync(this.statePath, 'utf8');
      return JSON.parse(raw) as AutopilotState;
    } catch {
      return defaultState();
    }
  }

  /** Persist the autopilot state. Stamps `updatedAt` automatically. */
  saveState(state: AutopilotState): void {
    state.updatedAt = new Date().toISOString();
    writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf8');
  }

  /** Append a pending action to the queue. */
  addPending(entry: PendingAction): void {
    const state = this.loadState();
    state.pending.push(entry);
    this.saveState(state);
  }

  /** Remove a pending action by its action ID. */
  removePending(actionId: string): void {
    const state = this.loadState();
    state.pending = state.pending.filter(p => p.actionId !== actionId);
    this.saveState(state);
  }

  /** Return all pending actions. */
  getPending(): PendingAction[] {
    return this.loadState().pending;
  }

  /** Associate an action ID with a Rover task ID and branch name. */
  setTaskMapping(actionId: string, mapping: TaskMapping): void {
    const state = this.loadState();
    if (!state.taskMappings) state.taskMappings = {};
    state.taskMappings[actionId] = mapping;
    this.saveState(state);
  }

  /** Look up the task mapping for a given action ID. */
  getTaskMapping(actionId: string): TaskMapping | undefined {
    const state = this.loadState();
    return state.taskMappings?.[actionId];
  }

  /** Append a structured log entry, rotating the file if it exceeds 5 MB. */
  appendLog(entry: AutopilotLogEntry): void {
    this.rotateIfNeeded();
    appendFileSync(this.logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  /** Rotate `log.jsonl` when it exceeds `LOG_MAX_BYTES`. Keeps up to 3 rotated files. */
  rotateIfNeeded(): void {
    try {
      const stats = statSync(this.logPath);
      if (stats.size < LOG_MAX_BYTES) return;
    } catch {
      return;
    }

    for (let i = LOG_MAX_ROTATED; i >= 2; i--) {
      const src = join(this.basePath, `log.${i - 1}.jsonl`);
      const dst = join(this.basePath, `log.${i}.jsonl`);

      if (i === LOG_MAX_ROTATED && existsSync(dst)) {
        unlinkSync(dst);
      }

      if (existsSync(src)) {
        renameSync(src, dst);
      }
    }

    renameSync(this.logPath, join(this.basePath, 'log.1.jsonl'));
  }

  /** Read a span by ID from the project's `spans/` directory. */
  readSpan(spanId: string): Span | null {
    const spanPath = join(
      getProjectPath(this.projectId),
      'spans',
      `${spanId}.json`
    );
    try {
      const raw = readFileSync(spanPath, 'utf8');
      return JSON.parse(raw) as Span;
    } catch {
      return null;
    }
  }

  /** Walk parent pointers to build the full span chain (root-first order). */
  getSpanTrace(spanId: string): Span[] {
    const trace: Span[] = [];
    let currentId: string | null = spanId;

    while (currentId) {
      const span = this.readSpan(currentId);
      if (!span) break;
      trace.unshift(span);
      currentId = span.parent;
    }

    return trace;
  }

  /** Read up to `maxEntries` log entries across current and rotated files. */
  readLogs(maxEntries = 500): AutopilotLogEntry[] {
    const entries: AutopilotLogEntry[] = [];

    // Rotated files first (oldest to newest)
    for (let i = LOG_MAX_ROTATED; i >= 1; i--) {
      const rotatedPath = join(this.basePath, `log.${i}.jsonl`);
      try {
        const raw = readFileSync(rotatedPath, 'utf8');
        for (const line of raw.split('\n')) {
          if (line.trim()) {
            try {
              entries.push(JSON.parse(line) as AutopilotLogEntry);
            } catch {
              // skip malformed lines
            }
          }
        }
      } catch {
        // file doesn't exist, skip
      }
    }

    // Current log file
    try {
      const raw = readFileSync(this.logPath, 'utf8');
      for (const line of raw.split('\n')) {
        if (line.trim()) {
          try {
            entries.push(JSON.parse(line) as AutopilotLogEntry);
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch {
      // file doesn't exist
    }

    return entries.slice(-maxEntries);
  }

  /** Read an action by ID from the project's `actions/` directory. */
  readAction(actionId: string): Action | null {
    const actionPath = join(
      getProjectPath(this.projectId),
      'actions',
      `${actionId}.json`
    );
    try {
      const raw = readFileSync(actionPath, 'utf8');
      return JSON.parse(raw) as Action;
    } catch {
      return null;
    }
  }

  /** Return all task mappings (action ID → task/branch). */
  getAllTaskMappings(): Record<string, TaskMapping> {
    return this.loadState().taskMappings ?? {};
  }

  /** Return the current wait queue. */
  getWaitQueue(): WaitEntry[] {
    return this.loadState().waitQueue ?? [];
  }

  /** Add an entry to the wait queue. */
  addWaitEntry(entry: WaitEntry): void {
    const state = this.loadState();
    if (!state.waitQueue) state.waitQueue = [];
    state.waitQueue.push(entry);
    this.saveState(state);
  }

  /** Remove a wait entry by action ID. */
  removeWaitEntry(actionId: string): void {
    const state = this.loadState();
    if (!state.waitQueue) return;
    state.waitQueue = state.waitQueue.filter(e => e.actionId !== actionId);
    this.saveState(state);
  }

  /** Serialize the in-memory trace map to disk. */
  saveTraces(traces: Map<string, TraceItem>): void {
    const data = Object.fromEntries(traces);
    writeFileSync(this.tracesPath, JSON.stringify(data), 'utf8');
  }

  /** Load traces from disk into a Map. Returns an empty map on failure. */
  loadTraces(): Map<string, TraceItem> {
    try {
      const raw = readFileSync(this.tracesPath, 'utf8');
      const data = JSON.parse(raw) as Record<string, TraceItem>;
      return new Map(Object.entries(data));
    } catch {
      return new Map();
    }
  }
}
