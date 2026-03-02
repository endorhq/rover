import React, { useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { ProjectManager } from 'rover-core';
import { getVersion } from 'rover-core';
import type { ViewMode } from './types.js';
import { AutopilotStore } from './store.js';
import {
  RoverHeader,
  SectionHeader,
  TracesSection,
  StarField,
  TasksSection,
  LogBook,
  KeyLegend,
} from './components.js';
import { InspectorView } from './inspector.js';
import {
  useTasks,
  useTerminalSize,
  useGitHubEvents,
  useLogEntries,
} from './hooks/index.js';
import { useStepOrchestrator } from './steps/use-orchestrator.js';
import { getUserAIAgent } from '../agents/index.js';

// ── Layout constants ────────────────────────────────────────────────────────

const HEADER_LINES = 5; // 1 blank + 3 art rows + 1 blank
const SECTION_HEADER_LINES = 3; // traces + tasks + log section headers
const TASK_SPACER_LINES = 1; // blank line before TASKS
const FIXED_TASK_ROWS = 3; // fixed number of visible task rows
const LEGEND_LINES = 1;
const FIXED_OVERHEAD = HEADER_LINES + SECTION_HEADER_LINES + LEGEND_LINES;
const MIN_LOG_HEIGHT = 3;

// ── App ─────────────────────────────────────────────────────────────────────

export function AutopilotApp({
  project,
  refreshInterval,
  fromDate,
  botName,
  maintainers,
}: {
  project: ProjectManager;
  refreshInterval: number;
  fromDate?: Date;
  botName?: string;
  maintainers?: string[];
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
    store,
    botName,
    maintainers
  );

  const { log: githubLog } = useGitHubEvents(
    project.path,
    project.id,
    store,
    requestDrain,
    fromDate
  );

  const logs = useLogEntries(store, tasks, statuses, githubLog);

  const [viewMode, setViewMode] = React.useState<ViewMode>('main');

  useInput((input, key) => {
    if (input === 'q' || (key.ctrl && input === 'c')) {
      exit();
    }
    if (input === 'i' && !key.ctrl && !key.meta && viewMode !== 'inspector') {
      setViewMode('inspector');
    }
  });

  // Layout calculations — vertical stack
  const logSpacer = tasks.length >= FIXED_TASK_ROWS ? 1 : 0;
  const available =
    rows - FIXED_OVERHEAD - TASK_SPACER_LINES - FIXED_TASK_ROWS - logSpacer;
  const logHeight = Math.max(MIN_LOG_HEIGHT, Math.floor(available * 0.4));
  const tracesHeight = Math.max(2, available - logHeight);

  const projectName = project.name ?? 'unknown';
  const agent = getUserAIAgent();
  const version = getVersion();

  const coordinatorActive = statuses.coordinator.status === 'processing';
  const workflowActive = statuses.workflow.status === 'processing';
  const resolverActive = statuses.resolver.status === 'processing';

  if (viewMode === 'inspector') {
    return (
      <Box flexDirection="column" height={rows} width={columns}>
        <InspectorView
          traces={traces}
          tracesRef={tracesRef}
          store={store}
          tasks={tasks}
          projectName={projectName}
          width={columns}
          height={rows}
          onClose={() => setViewMode('main')}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      {/* Header: 3 lines — ASCII art + project info + step indicators */}
      <RoverHeader
        version={version}
        agent={agent}
        projectName={projectName}
        coordinatorActive={coordinatorActive}
        workflowActive={workflowActive}
        resolverActive={resolverActive}
      />

      {/* Traces section */}
      <SectionHeader title="TRACES" width={columns} />
      <Box height={tracesHeight}>
        <Box flexGrow={1}>
          <TracesSection traces={traces} maxVisible={tracesHeight} />
        </Box>
        <StarField height={tracesHeight} />
      </Box>

      {/* Tasks section */}
      <Text> </Text>
      <SectionHeader title="TASKS" width={columns} />
      <Box height={FIXED_TASK_ROWS}>
        <TasksSection
          tasks={tasks}
          maxVisible={FIXED_TASK_ROWS}
          width={columns}
        />
      </Box>

      {/* Log section */}
      {tasks.length >= FIXED_TASK_ROWS && <Text> </Text>}
      <SectionHeader title="LOG" width={columns} />
      <LogBook entries={logs} height={logHeight} width={columns} />

      {/* Key legend */}
      <KeyLegend />
    </Box>
  );
}
