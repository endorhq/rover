import React, { useState, useEffect, useRef } from 'react';
import { Box, useInput, useApp, useStdout } from 'ink';
import type {
  ProjectManager,
  IterationManager,
  IterationStatusManager,
} from 'rover-core';
import { getVersion } from 'rover-core';
import type { TaskInfo, LogEntry, WorkSlot, ViewMode } from './types.js';
import { formatDuration } from './helpers.js';
import { AutopilotStore } from './store.js';
import { InfoPanel, SpaceScene, LogBook } from './components.js';
import { InspectorView } from './inspector.js';
import { useGitHubEvents, POLL_INTERVAL_SEC } from './events.js';
import { useStepOrchestrator } from './steps/use-orchestrator.js';
import { getUserAIAgent } from '../agents/index.js';

const MIN_LOG_HEIGHT = 5; // 3 visible lines + 2 for border

const maybeIterationStatus = (
  iteration?: IterationManager
): IterationStatusManager | undefined => {
  try {
    return iteration?.status();
  } catch {
    return undefined;
  }
};

function buildWorkSlots(tasks: TaskInfo[]): WorkSlot[] {
  if (tasks.length === 0) {
    // show 4 idle placeholders when no tasks exist
    return Array.from({ length: 4 }, (_, i) => ({
      id: i,
      label: `slot ${i + 1}`,
      status: 'idle' as const,
      fill: '\u2591',
    }));
  }

  return tasks.map(t => {
    let status: WorkSlot['status'] = 'idle';
    if (['IN_PROGRESS', 'ITERATING'].includes(t.status)) status = 'running';
    else if (['COMPLETED', 'MERGED', 'PUSHED'].includes(t.status))
      status = 'done';
    else if (t.status === 'FAILED') status = 'error';

    return {
      id: t.id,
      label: `#${t.id}`,
      status,
      fill: '\u2591',
    };
  });
}

function useTasks(project: ProjectManager, refreshInterval: number) {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);

  useEffect(() => {
    const load = () => {
      try {
        const allTasks = project.listTasks();
        const infos: TaskInfo[] = [];

        for (const task of allTasks) {
          const lastIteration = task.getLastIteration();
          const iterStatus = maybeIterationStatus(lastIteration);
          const taskStatus = task.status;

          let endTime: string | undefined;
          if (taskStatus === 'FAILED') {
            endTime = task.failedAt;
          } else if (['COMPLETED', 'MERGED', 'PUSHED'].includes(taskStatus)) {
            endTime = task.completedAt;
          }

          let agentDisplay = task.agent || '-';
          if (task.agent && task.agentModel) {
            agentDisplay = `${task.agent}:${task.agentModel}`;
          }

          infos.push({
            id: task.id,
            title: task.title || `Task #${task.id}`,
            status: taskStatus,
            progress: iterStatus?.progress ?? 0,
            agent: agentDisplay,
            duration: formatDuration(task.startedAt, endTime),
            iteration: task.iterations,
          });
        }

        setTasks(infos);
      } catch {
        // silently handle
      }
    };

    load();
    const timer = setInterval(load, refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [project, refreshInterval]);

  return tasks;
}

function useTerminalSize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout.columns || 80,
    rows: stdout.rows || 24,
  });

  useEffect(() => {
    const onResize = () => {
      setSize({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return size;
}

export function AutopilotApp({
  project,
  refreshInterval,
}: {
  project: ProjectManager;
  refreshInterval: number;
}) {
  const { exit } = useApp();
  const tasks = useTasks(project, refreshInterval);
  const { columns, rows } = useTerminalSize();

  // Single shared store — created once, used by both hooks
  const storeRef = useRef<AutopilotStore | null>(null);
  if (!storeRef.current) {
    const s = new AutopilotStore(project.id);
    s.ensureDir();
    storeRef.current = s;
  }
  const store = storeRef.current!;

  const { statuses, traces, tracesRef, requestDrain } = useStepOrchestrator(
    project,
    project.path,
    project.id,
    store
  );

  const {
    status: fetchStatus,
    lastFetchAt,
    lastFetchCount,
    lastRelevantCount,
    lastNewCount,
  } = useGitHubEvents(project.path, project.id, store, requestDrain);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('main');

  useEffect(() => {
    const ts = new Date().toLocaleTimeString();
    const entries: LogEntry[] = [
      { timestamp: ts, message: 'Autopilot started' },
    ];

    const pending = store.getPending();
    if (pending.length > 0) {
      entries.push({
        timestamp: ts,
        message: `Autopilot resumed: ${pending.length} pending actions`,
      });
    }

    setLogs(entries);
  }, [store]);

  // Destructure step statuses for the InfoPanel and consolidated log effect
  const { status: coordinatorStatus, processedCount } = statuses.coordinator;
  const { status: plannerStatus, processedCount: plannerProcessedCount } =
    statuses.planner;
  const {
    status: workflowRunnerStatus,
    processedCount: workflowRunnerProcessedCount,
  } = statuses.workflow;
  const { status: committerStatus, processedCount: committerProcessedCount } =
    statuses.committer;
  const { status: resolverStatus, processedCount: resolverProcessedCount } =
    statuses.resolver;
  const { status: pusherStatus, processedCount: pusherProcessedCount } =
    statuses.pusher;

  // Build a stable key for all the values that should trigger a log update.
  // A single effect produces one setLogs call instead of up to 8 separate ones.
  const taskKey = tasks.map(t => `${t.id}:${t.status}`).join(',');
  const statusKey = [
    fetchStatus,
    lastFetchCount,
    lastRelevantCount,
    lastNewCount,
    coordinatorStatus,
    processedCount,
    plannerStatus,
    plannerProcessedCount,
    workflowRunnerStatus,
    workflowRunnerProcessedCount,
    committerStatus,
    committerProcessedCount,
    resolverStatus,
    resolverProcessedCount,
    pusherStatus,
    pusherProcessedCount,
  ].join(',');

  const prevStatusKeyRef = useRef(statusKey);
  const prevTaskKeyRef = useRef(taskKey);

  useEffect(() => {
    const newEntries: LogEntry[] = [];
    const ts = new Date().toLocaleTimeString();

    // Task status changes
    if (taskKey !== prevTaskKeyRef.current && tasks.length > 0) {
      const running = tasks.filter(t =>
        ['IN_PROGRESS', 'ITERATING'].includes(t.status)
      ).length;
      const completed = tasks.filter(t =>
        ['COMPLETED', 'MERGED', 'PUSHED'].includes(t.status)
      ).length;
      const failed = tasks.filter(t => t.status === 'FAILED').length;
      newEntries.push({
        timestamp: ts,
        message: `Tasks: ${tasks.length} total, ${running} running, ${completed} completed, ${failed} failed`,
      });
    }

    // GitHub fetch results
    if (fetchStatus === 'done') {
      newEntries.push({
        timestamp: ts,
        message: `GitHub: ${lastNewCount} new events (${lastRelevantCount} relevant, ${lastFetchCount} fetched)`,
      });
    } else if (fetchStatus === 'error') {
      newEntries.push({
        timestamp: ts,
        message: 'GitHub: failed to fetch events',
      });
    }

    // Step status changes — collected in a single pass
    const stepEntries: Array<{
      label: string;
      status: string;
      count: number;
      processing: string;
      idle: string;
    }> = [
      {
        label: 'Coordinator',
        status: coordinatorStatus,
        count: processedCount,
        processing: 'processing...',
        idle: 'processed',
      },
      {
        label: 'Planner',
        status: plannerStatus,
        count: plannerProcessedCount,
        processing: 'processing...',
        idle: 'processed',
      },
      {
        label: 'Workflow runner',
        status: workflowRunnerStatus,
        count: workflowRunnerProcessedCount,
        processing: 'processing...',
        idle: 'tasks created',
      },
      {
        label: 'Committer',
        status: committerStatus,
        count: committerProcessedCount,
        processing: 'committing...',
        idle: 'committed',
      },
      {
        label: 'Resolver',
        status: resolverStatus,
        count: resolverProcessedCount,
        processing: 'resolving...',
        idle: 'resolved',
      },
      {
        label: 'Pusher',
        status: pusherStatus,
        count: pusherProcessedCount,
        processing: 'pushing...',
        idle: 'pushed',
      },
    ];

    for (const entry of stepEntries) {
      if (entry.status === 'processing') {
        newEntries.push({
          timestamp: ts,
          message: `${entry.label}: ${entry.processing}`,
        });
      } else if (entry.count > 0 && entry.status === 'idle') {
        newEntries.push({
          timestamp: ts,
          message: `${entry.label}: ${entry.count} ${entry.idle}`,
        });
      }
    }

    prevStatusKeyRef.current = statusKey;
    prevTaskKeyRef.current = taskKey;

    if (newEntries.length > 0) {
      setLogs(prev => [...prev.slice(-50), ...newEntries]);
    }
  }, [
    taskKey,
    tasks,
    fetchStatus,
    lastFetchCount,
    lastRelevantCount,
    lastNewCount,
    statusKey,
    coordinatorStatus,
    processedCount,
    plannerStatus,
    plannerProcessedCount,
    workflowRunnerStatus,
    workflowRunnerProcessedCount,
    committerStatus,
    committerProcessedCount,
    resolverStatus,
    resolverProcessedCount,
    pusherStatus,
    pusherProcessedCount,
  ]);

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
    }
    if (input === 'i' && !key.ctrl && !key.meta && viewMode !== 'inspector') {
      setViewMode('inspector');
    }
  });

  // Layout calculations
  const logHeight = Math.max(MIN_LOG_HEIGHT, Math.floor(rows * 0.3));
  const topHeight = rows - logHeight;
  const leftWidth = Math.floor(columns * 0.3);
  const rightWidth = columns - leftWidth;

  const projectName = project.name ?? 'unknown';
  const agent = getUserAIAgent();
  const version = getVersion();
  const slots = buildWorkSlots(tasks);

  if (viewMode === 'inspector') {
    return (
      <Box flexDirection="column" height={rows} width={columns}>
        <InspectorView
          traces={traces}
          tracesRef={tracesRef}
          store={store}
          tasks={tasks}
          width={columns}
          height={rows}
          onClose={() => setViewMode('main')}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      {/* Top row: 70% */}
      <Box height={topHeight}>
        {/* Left column: 30% — info panel */}
        <Box width={leftWidth}>
          <InfoPanel
            projectName={projectName}
            agent={agent}
            version={version}
            height={topHeight}
            fetchStatus={fetchStatus}
            lastFetchAt={lastFetchAt}
            pollIntervalSec={POLL_INTERVAL_SEC}
            coordinatorStatus={coordinatorStatus}
            processedCount={processedCount}
            plannerStatus={plannerStatus}
            plannerProcessedCount={plannerProcessedCount}
            workflowRunnerStatus={workflowRunnerStatus}
            workflowRunnerProcessedCount={workflowRunnerProcessedCount}
            committerStatus={committerStatus}
            committerProcessedCount={committerProcessedCount}
            resolverStatus={resolverStatus}
            resolverProcessedCount={resolverProcessedCount}
            pusherStatus={pusherStatus}
            pusherProcessedCount={pusherProcessedCount}
          />
        </Box>
        {/* Right column: 70% — space scene + work boxes */}
        <Box width={rightWidth}>
          <SpaceScene
            width={Math.max(1, rightWidth - 2)}
            height={topHeight}
            slots={slots}
            traces={traces}
          />
        </Box>
      </Box>
      {/* Bottom row: 30% — log book */}
      <LogBook entries={logs} height={logHeight} />
    </Box>
  );
}
