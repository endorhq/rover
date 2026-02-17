import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, useInput, useApp, useStdout } from 'ink';
import type {
  ProjectManager,
  IterationManager,
  IterationStatusManager,
} from 'rover-core';
import { getVersion } from 'rover-core';
import type {
  TaskInfo,
  LogEntry,
  WorkSlot,
  ViewMode,
  ActionChain,
} from './types.js';
import { formatDuration } from './helpers.js';
import {
  InfoPanel,
  SpaceScene,
  LogBook,
  ActionsDetailView,
} from './components.js';
import { useGitHubEvents } from './events.js';
import { useCoordinator } from './coordinator.js';
import { usePlanner } from './planner.js';
import { useWorkflowRunner } from './workflow-runner.js';
import { getUserAIAgent } from '../agents/index.js';
import { AutopilotStore } from './store.js';

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

  // Shared chains state: lifted from coordinator so planner can also update it
  const chainsRef = useRef<Map<string, ActionChain>>(new Map());
  const [chainsVersion, setChainsVersion] = useState(0);
  const onChainsUpdated = useCallback(() => setChainsVersion(v => v + 1), []);

  const { status: coordinatorStatus, processedCount } = useCoordinator(
    project.path,
    project.id,
    chainsRef,
    onChainsUpdated
  );

  const { status: plannerStatus, processedCount: plannerProcessedCount } =
    usePlanner(project.path, project.id, chainsRef, onChainsUpdated);

  const {
    status: workflowRunnerStatus,
    processedCount: workflowRunnerProcessedCount,
  } = useWorkflowRunner(
    project,
    project.path,
    project.id,
    chainsRef,
    onChainsUpdated
  );

  const chains = Array.from(chainsRef.current.values());

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('main');

  // Push a startup log entry (with recovery info)
  const storeRef = useRef<AutopilotStore | null>(null);
  if (!storeRef.current) {
    const store = new AutopilotStore(project.id);
    store.ensureDir();
    storeRef.current = store;
  }

  useEffect(() => {
    const ts = new Date().toLocaleTimeString();
    const entries: LogEntry[] = [
      { timestamp: ts, message: 'Autopilot started' },
    ];

    const store = storeRef.current;
    if (store) {
      const pending = store.getPending();
      if (pending.length > 0) {
        entries.push({
          timestamp: ts,
          message: `Autopilot resumed: ${pending.length} pending actions`,
        });
      }
    }

    setLogs(entries);
  }, []);

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

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
    }
    if (key.ctrl && input === 'a') {
      setViewMode(prev => (prev === 'main' ? 'actions' : 'main'));
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

  if (viewMode === 'actions') {
    return (
      <Box flexDirection="column" height={rows} width={columns}>
        <ActionsDetailView chains={chains} width={columns} height={rows} />
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
          />
        </Box>
        {/* Right column: 70% — space scene + work boxes */}
        <Box width={rightWidth}>
          <SpaceScene
            width={Math.max(1, rightWidth - 2)}
            height={topHeight}
            slots={slots}
            chains={chains}
          />
        </Box>
      </Box>
      {/* Bottom row: 30% — log book */}
      <LogBook entries={logs} height={logHeight} />
    </Box>
  );
}
