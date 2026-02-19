import React, { useState, useEffect } from 'react';
import { Box, useInput, useApp, useStdout } from 'ink';
import type {
  ProjectManager,
  IterationManager,
  IterationStatusManager,
} from 'rover-core';
import { getVersion } from 'rover-core';
import type { TaskInfo, LogEntry, WorkSlot, ViewMode } from './types.js';
import { formatDuration } from './helpers.js';
import { InfoPanel, SpaceScene, LogBook } from './components.js';
import { InspectorView } from './inspector.js';
import { useGitHubEvents } from './events.js';
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
  const {
    status: fetchStatus,
    countdown: fetchCountdown,
    lastFetchCount,
    lastRelevantCount,
    lastNewCount,
  } = useGitHubEvents(project.path, project.id);

  const { statuses, traces, tracesRef, store } = useStepOrchestrator(
    project,
    project.path,
    project.id
  );

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

  // Log task status changes
  useEffect(() => {
    if (tasks.length === 0) return;
    const ts = new Date().toLocaleTimeString();
    const running = tasks.filter(t =>
      ['IN_PROGRESS', 'ITERATING'].includes(t.status)
    ).length;
    const completed = tasks.filter(t =>
      ['COMPLETED', 'MERGED', 'PUSHED'].includes(t.status)
    ).length;
    const failed = tasks.filter(t => t.status === 'FAILED').length;

    setLogs(prev => [
      ...prev.slice(-50),
      {
        timestamp: ts,
        message: `Tasks: ${tasks.length} total, ${running} running, ${completed} completed, ${failed} failed`,
      },
    ]);
  }, [tasks.map(t => `${t.id}:${t.status}`).join(',')]);

  // Log GitHub event fetch results
  useEffect(() => {
    if (fetchStatus === 'done') {
      const ts = new Date().toLocaleTimeString();
      setLogs(prev => [
        ...prev.slice(-50),
        {
          timestamp: ts,
          message: `GitHub: ${lastNewCount} new events (${lastRelevantCount} relevant, ${lastFetchCount} fetched)`,
        },
      ]);
    } else if (fetchStatus === 'error') {
      const ts = new Date().toLocaleTimeString();
      setLogs(prev => [
        ...prev.slice(-50),
        {
          timestamp: ts,
          message: 'GitHub: failed to fetch events',
        },
      ]);
    }
  }, [fetchStatus, lastFetchCount, lastRelevantCount, lastNewCount]);

  // Log coordinator status changes
  const { status: coordinatorStatus, processedCount } = statuses.coordinator;
  useEffect(() => {
    if (coordinatorStatus === 'processing') {
      const ts = new Date().toLocaleTimeString();
      setLogs(prev => [
        ...prev.slice(-50),
        { timestamp: ts, message: 'Coordinator: processing...' },
      ]);
    } else if (processedCount > 0 && coordinatorStatus === 'idle') {
      const ts = new Date().toLocaleTimeString();
      setLogs(prev => [
        ...prev.slice(-50),
        {
          timestamp: ts,
          message: `Coordinator: ${processedCount} processed`,
        },
      ]);
    }
  }, [coordinatorStatus, processedCount]);

  // Log planner status changes
  const { status: plannerStatus, processedCount: plannerProcessedCount } =
    statuses.planner;
  useEffect(() => {
    if (plannerStatus === 'processing') {
      const ts = new Date().toLocaleTimeString();
      setLogs(prev => [
        ...prev.slice(-50),
        { timestamp: ts, message: 'Planner: processing...' },
      ]);
    } else if (plannerProcessedCount > 0 && plannerStatus === 'idle') {
      const ts = new Date().toLocaleTimeString();
      setLogs(prev => [
        ...prev.slice(-50),
        {
          timestamp: ts,
          message: `Planner: ${plannerProcessedCount} processed`,
        },
      ]);
    }
  }, [plannerStatus, plannerProcessedCount]);

  // Log workflow runner status changes
  const {
    status: workflowRunnerStatus,
    processedCount: workflowRunnerProcessedCount,
  } = statuses.workflow;
  useEffect(() => {
    if (workflowRunnerStatus === 'processing') {
      const ts = new Date().toLocaleTimeString();
      setLogs(prev => [
        ...prev.slice(-50),
        { timestamp: ts, message: 'Workflow runner: processing...' },
      ]);
    } else if (
      workflowRunnerProcessedCount > 0 &&
      workflowRunnerStatus === 'idle'
    ) {
      const ts = new Date().toLocaleTimeString();
      setLogs(prev => [
        ...prev.slice(-50),
        {
          timestamp: ts,
          message: `Workflow runner: ${workflowRunnerProcessedCount} tasks created`,
        },
      ]);
    }
  }, [workflowRunnerStatus, workflowRunnerProcessedCount]);

  // Log committer status changes
  const { status: committerStatus, processedCount: committerProcessedCount } =
    statuses.committer;
  useEffect(() => {
    if (committerStatus === 'processing') {
      const ts = new Date().toLocaleTimeString();
      setLogs(prev => [
        ...prev.slice(-50),
        { timestamp: ts, message: 'Committer: processing...' },
      ]);
    } else if (committerProcessedCount > 0 && committerStatus === 'idle') {
      const ts = new Date().toLocaleTimeString();
      setLogs(prev => [
        ...prev.slice(-50),
        {
          timestamp: ts,
          message: `Committer: ${committerProcessedCount} committed`,
        },
      ]);
    }
  }, [committerStatus, committerProcessedCount]);

  // Log resolver status changes
  const { status: resolverStatus, processedCount: resolverProcessedCount } =
    statuses.resolver;
  useEffect(() => {
    if (resolverStatus === 'processing') {
      const ts = new Date().toLocaleTimeString();
      setLogs(prev => [
        ...prev.slice(-50),
        { timestamp: ts, message: 'Resolver: processing...' },
      ]);
    } else if (resolverProcessedCount > 0 && resolverStatus === 'idle') {
      const ts = new Date().toLocaleTimeString();
      setLogs(prev => [
        ...prev.slice(-50),
        {
          timestamp: ts,
          message: `Resolver: ${resolverProcessedCount} resolved`,
        },
      ]);
    }
  }, [resolverStatus, resolverProcessedCount]);

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
            fetchCountdown={fetchCountdown}
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
