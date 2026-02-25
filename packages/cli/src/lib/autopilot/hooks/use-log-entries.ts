import { useState, useEffect, useRef } from 'react';
import type { LogEntry, TaskInfo } from '../types.js';
import type { AutopilotStore } from '../store.js';
import type { StepStatuses } from '../steps/use-orchestrator.js';

const MAX_LOG_ENTRIES = 50;

function ts(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function appendLog(prev: LogEntry[], ...entries: LogEntry[]): LogEntry[] {
  if (entries.length === 0) return prev;
  return [...prev.slice(-(MAX_LOG_ENTRIES - entries.length)), ...entries];
}

// ── Step log labels ─────────────────────────────────────────────────────────

const STEP_LOG: Array<{
  key: keyof StepStatuses;
  label: string;
  processing: string;
  idle: string;
}> = [
  {
    key: 'coordinator',
    label: 'Coordinator',
    processing: 'processing...',
    idle: 'processed',
  },
  {
    key: 'planner',
    label: 'Planner',
    processing: 'processing...',
    idle: 'processed',
  },
  {
    key: 'workflow',
    label: 'Workflow runner',
    processing: 'processing...',
    idle: 'tasks created',
  },
  {
    key: 'committer',
    label: 'Committer',
    processing: 'committing...',
    idle: 'committed',
  },
  {
    key: 'resolver',
    label: 'Resolver',
    processing: 'resolving...',
    idle: 'resolved',
  },
  { key: 'pusher', label: 'Pusher', processing: 'pushing...', idle: 'pushed' },
];

// ── Hook ────────────────────────────────────────────────────────────────────

export function useLogEntries(
  store: AutopilotStore,
  tasks: TaskInfo[],
  statuses: StepStatuses,
  githubLog: LogEntry | null
): LogEntry[] {
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Boot message — runs once
  useEffect(() => {
    const entries: LogEntry[] = [
      { timestamp: ts(), message: 'Autopilot started' },
    ];
    const pending = store.getPending();
    if (pending.length > 0) {
      entries.push({
        timestamp: ts(),
        message: `Autopilot resumed: ${pending.length} pending actions`,
      });
    }
    setLogs(entries);
  }, [store]);

  // GitHub log — appended when the hook produces a new message
  const prevGithubLogRef = useRef(githubLog);
  useEffect(() => {
    if (githubLog && githubLog !== prevGithubLogRef.current) {
      prevGithubLogRef.current = githubLog;
      setLogs(prev => appendLog(prev, githubLog));
    }
  }, [githubLog]);

  // Task status changes
  const taskKeyRef = useRef('');
  useEffect(() => {
    const key = tasks.map(t => `${t.id}:${t.status}`).join(',');
    if (key === taskKeyRef.current || tasks.length === 0) return;
    taskKeyRef.current = key;

    const running = tasks.filter(t =>
      ['IN_PROGRESS', 'ITERATING'].includes(t.status)
    ).length;
    const completed = tasks.filter(t =>
      ['COMPLETED', 'MERGED', 'PUSHED'].includes(t.status)
    ).length;
    const failed = tasks.filter(t => t.status === 'FAILED').length;

    setLogs(prev =>
      appendLog(prev, {
        timestamp: ts(),
        message: `Tasks: ${tasks.length} total, ${running} running, ${completed} completed, ${failed} failed`,
      })
    );
  }, [tasks]);

  // Step status changes — each step tracked independently
  const prevStepRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const entries: LogEntry[] = [];
    const now = ts();

    for (const step of STEP_LOG) {
      const { status, processedCount } = statuses[step.key];
      const prevKey = prevStepRef.current[step.key];
      const curKey = `${status}:${processedCount}`;
      if (curKey === prevKey) continue;
      prevStepRef.current = { ...prevStepRef.current, [step.key]: curKey };

      if (status === 'processing') {
        entries.push({
          timestamp: now,
          message: `${step.label}: ${step.processing}`,
        });
      } else if (processedCount > 0 && status === 'idle') {
        entries.push({
          timestamp: now,
          message: `${step.label}: ${processedCount} ${step.idle}`,
        });
      }
    }

    if (entries.length > 0) {
      setLogs(prev => appendLog(prev, ...entries));
    }
  }, [statuses]);

  return logs;
}
