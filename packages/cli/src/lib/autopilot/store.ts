import { join } from 'node:path';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  statSync,
  renameSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { getDataDir } from 'rover-core';
import type {
  EventCursor,
  PendingAction,
  AutopilotState,
  AutopilotLogEntry,
  Trace,
  TaskMapping,
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

export class AutopilotStore {
  private projectId: string;
  private basePath: string;
  private cursorPath: string;
  private statePath: string;
  private logPath: string;

  constructor(projectId: string) {
    this.projectId = projectId;
    this.basePath = join(getDataDir(), 'projects', projectId, 'autopilot');
    this.cursorPath = join(this.basePath, 'cursor.json');
    this.statePath = join(this.basePath, 'state.json');
    this.logPath = join(this.basePath, 'log.jsonl');
  }

  ensureDir(): void {
    mkdirSync(this.basePath, { recursive: true });
    if (!existsSync(this.cursorPath)) {
      this.saveCursor(defaultCursor());
    }
    if (!existsSync(this.statePath)) {
      this.saveState(defaultState());
    }
  }

  // --- Cursor methods ---

  loadCursor(): EventCursor {
    try {
      const raw = readFileSync(this.cursorPath, 'utf8');
      return JSON.parse(raw) as EventCursor;
    } catch {
      return defaultCursor();
    }
  }

  saveCursor(cursor: EventCursor): void {
    cursor.updatedAt = new Date().toISOString();
    writeFileSync(this.cursorPath, JSON.stringify(cursor, null, 2), 'utf8');
  }

  isEventProcessed(eventId: string): boolean {
    const cursor = this.loadCursor();
    return cursor.processedEventIds.includes(eventId);
  }

  markEventsProcessed(eventIds: string[]): void {
    const cursor = this.loadCursor();
    cursor.processedEventIds.push(...eventIds);
    // Trim to last CURSOR_MAX_IDS entries
    if (cursor.processedEventIds.length > CURSOR_MAX_IDS) {
      cursor.processedEventIds = cursor.processedEventIds.slice(
        -CURSOR_MAX_IDS
      );
    }
    this.saveCursor(cursor);
  }

  // --- State methods ---

  loadState(): AutopilotState {
    try {
      const raw = readFileSync(this.statePath, 'utf8');
      return JSON.parse(raw) as AutopilotState;
    } catch {
      return defaultState();
    }
  }

  saveState(state: AutopilotState): void {
    state.updatedAt = new Date().toISOString();
    writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf8');
  }

  addPending(entry: PendingAction): void {
    const state = this.loadState();
    state.pending.push(entry);
    this.saveState(state);
  }

  removePending(actionId: string): void {
    const state = this.loadState();
    state.pending = state.pending.filter(p => p.actionId !== actionId);
    this.saveState(state);
  }

  getPending(): PendingAction[] {
    return this.loadState().pending;
  }

  setTaskMapping(actionId: string, mapping: TaskMapping): void {
    const state = this.loadState();
    if (!state.taskMappings) state.taskMappings = {};
    state.taskMappings[actionId] = mapping;
    this.saveState(state);
  }

  getTaskMapping(actionId: string): TaskMapping | undefined {
    const state = this.loadState();
    return state.taskMappings?.[actionId];
  }

  // --- Log methods ---

  appendLog(entry: AutopilotLogEntry): void {
    this.rotateIfNeeded();
    appendFileSync(this.logPath, JSON.stringify(entry) + '\n', 'utf8');
  }

  rotateIfNeeded(): void {
    try {
      const stats = statSync(this.logPath);
      if (stats.size < LOG_MAX_BYTES) return;
    } catch {
      // File doesn't exist yet, nothing to rotate
      return;
    }

    // Shift existing rotated files: 2→3, 1→2
    for (let i = LOG_MAX_ROTATED; i >= 2; i--) {
      const src = join(this.basePath, `log.${i - 1}.jsonl`);
      const dst = join(this.basePath, `log.${i}.jsonl`);

      // Delete the last rotated file if it would be overwritten
      if (i === LOG_MAX_ROTATED && existsSync(dst)) {
        unlinkSync(dst);
      }

      if (existsSync(src)) {
        renameSync(src, dst);
      }
    }

    // Rename current log to log.1.jsonl
    renameSync(this.logPath, join(this.basePath, 'log.1.jsonl'));
  }

  // --- Trace methods ---

  readTrace(traceId: string): Trace | null {
    const tracePath = join(
      getDataDir(),
      'projects',
      this.projectId,
      'traces',
      `${traceId}.json`
    );
    try {
      const raw = readFileSync(tracePath, 'utf8');
      return JSON.parse(raw) as Trace;
    } catch {
      return null;
    }
  }

  getTraceChain(traceId: string): Trace[] {
    const chain: Trace[] = [];
    let currentId: string | null = traceId;

    while (currentId) {
      const trace = this.readTrace(currentId);
      if (!trace) break;
      chain.unshift(trace);
      currentId = trace.parent;
    }

    return chain;
  }
}
