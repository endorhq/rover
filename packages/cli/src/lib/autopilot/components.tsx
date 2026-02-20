import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import type {
  FetchStatus,
  LogEntry,
  WorkSlot,
  CoordinatorStatus,
  PlannerStatus,
  WorkflowRunnerStatus,
  CommitterStatus,
  ResolverStatus,
  PusherStatus,
  ActionTrace,
  ActionStepStatus,
} from './types.js';
import {
  createStarField,
  advanceStars,
  renderStarField,
  getPlanetArt,
  getSlotFill,
} from './helpers.js';

// ── Fetch Status Indicator ───────────────────────────────────────────────────

const FETCH_ICONS: Record<FetchStatus, string> = {
  idle: '\u25CB', // ○
  fetching: '\u21BB', // ↻
  done: '\u25CF', // ●
  error: '\u2717', // ✗
};

const FETCH_COLORS: Record<FetchStatus, string> = {
  idle: 'gray',
  fetching: 'yellow',
  done: 'green',
  error: 'red',
};

function FetchIndicator({
  status,
  countdown,
}: {
  status: FetchStatus;
  countdown: number;
}) {
  const icon = FETCH_ICONS[status];
  const color = FETCH_COLORS[status];
  const label =
    status === 'fetching'
      ? 'syncing...'
      : status === 'error'
        ? 'sync failed'
        : `next ${countdown}s`;

  return (
    <Text>
      <Text color={color}>{icon} </Text>
      <Text dimColor>{label}</Text>
    </Text>
  );
}

// ── Coordinator Status Indicator ─────────────────────────────────────────────

const COORDINATOR_ICONS: Record<CoordinatorStatus, string> = {
  idle: '\u25CB', // ○
  processing: '\u21BB', // ↻
  error: '\u2717', // ✗
};

const COORDINATOR_COLORS: Record<CoordinatorStatus, string> = {
  idle: 'gray',
  processing: 'cyan',
  error: 'red',
};

function CoordinatorIndicator({
  status,
  processedCount,
}: {
  status: CoordinatorStatus;
  processedCount: number;
}) {
  const icon = COORDINATOR_ICONS[status];
  const color = COORDINATOR_COLORS[status];
  const label =
    status === 'processing'
      ? 'coordinating...'
      : status === 'error'
        ? 'coordinator error'
        : `${processedCount} processed`;

  return (
    <Text>
      <Text color={color}>{icon} </Text>
      <Text dimColor>{label}</Text>
    </Text>
  );
}

// ── Planner Status Indicator ─────────────────────────────────────────────────

const PLANNER_ICONS: Record<PlannerStatus, string> = {
  idle: '\u25CB', // ○
  processing: '\u21BB', // ↻
  error: '\u2717', // ✗
};

const PLANNER_COLORS: Record<PlannerStatus, string> = {
  idle: 'gray',
  processing: 'magenta',
  error: 'red',
};

function PlannerIndicator({
  status,
  processedCount,
}: {
  status: PlannerStatus;
  processedCount: number;
}) {
  const icon = PLANNER_ICONS[status];
  const color = PLANNER_COLORS[status];
  const label =
    status === 'processing'
      ? 'planning...'
      : status === 'error'
        ? 'planner error'
        : `${processedCount} planned`;

  return (
    <Text>
      <Text color={color}>{icon} </Text>
      <Text dimColor>{label}</Text>
    </Text>
  );
}

// ── Workflow Runner Status Indicator ─────────────────────────────────────────

const WORKFLOW_RUNNER_ICONS: Record<WorkflowRunnerStatus, string> = {
  idle: '\u25CB', // ○
  processing: '\u21BB', // ↻
  error: '\u2717', // ✗
};

const WORKFLOW_RUNNER_COLORS: Record<WorkflowRunnerStatus, string> = {
  idle: 'gray',
  processing: 'blue',
  error: 'red',
};

function WorkflowRunnerIndicator({
  status,
  processedCount,
}: {
  status: WorkflowRunnerStatus;
  processedCount: number;
}) {
  const icon = WORKFLOW_RUNNER_ICONS[status];
  const color = WORKFLOW_RUNNER_COLORS[status];
  const label =
    status === 'processing'
      ? 'launching...'
      : status === 'error'
        ? 'runner error'
        : `${processedCount} launched`;

  return (
    <Text>
      <Text color={color}>{icon} </Text>
      <Text dimColor>{label}</Text>
    </Text>
  );
}

// ── Committer Status Indicator ────────────────────────────────────────────────

const COMMITTER_ICONS: Record<CommitterStatus, string> = {
  idle: '\u25CB', // ○
  processing: '\u21BB', // ↻
  error: '\u2717', // ✗
};

const COMMITTER_COLORS: Record<CommitterStatus, string> = {
  idle: 'gray',
  processing: 'green',
  error: 'red',
};

function CommitterIndicator({
  status,
  processedCount,
}: {
  status: CommitterStatus;
  processedCount: number;
}) {
  const icon = COMMITTER_ICONS[status];
  const color = COMMITTER_COLORS[status];
  const label =
    status === 'processing'
      ? 'committing...'
      : status === 'error'
        ? 'committer error'
        : `${processedCount} committed`;

  return (
    <Text>
      <Text color={color}>{icon} </Text>
      <Text dimColor>{label}</Text>
    </Text>
  );
}

// ── Resolver Status Indicator ────────────────────────────────────────────────

const RESOLVER_ICONS: Record<ResolverStatus, string> = {
  idle: '\u25CB', // ○
  processing: '\u21BB', // ↻
  error: '\u2717', // ✗
};

const RESOLVER_COLORS: Record<ResolverStatus, string> = {
  idle: 'gray',
  processing: 'yellow',
  error: 'red',
};

function ResolverIndicator({
  status,
  processedCount,
}: {
  status: ResolverStatus;
  processedCount: number;
}) {
  const icon = RESOLVER_ICONS[status];
  const color = RESOLVER_COLORS[status];
  const label =
    status === 'processing'
      ? 'resolving...'
      : status === 'error'
        ? 'resolver error'
        : `${processedCount} resolved`;

  return (
    <Text>
      <Text color={color}>{icon} </Text>
      <Text dimColor>{label}</Text>
    </Text>
  );
}

// ── Pusher Status Indicator ──────────────────────────────────────────────────

const PUSHER_ICONS: Record<PusherStatus, string> = {
  idle: '\u25CB', // ○
  processing: '\u21BB', // ↻
  error: '\u2717', // ✗
};

const PUSHER_COLORS: Record<PusherStatus, string> = {
  idle: 'gray',
  processing: 'magentaBright',
  error: 'red',
};

function PusherIndicator({
  status,
  processedCount,
}: {
  status: PusherStatus;
  processedCount: number;
}) {
  const icon = PUSHER_ICONS[status];
  const color = PUSHER_COLORS[status];
  const label =
    status === 'processing'
      ? 'pushing...'
      : status === 'error'
        ? 'pusher error'
        : `${processedCount} pushed`;

  return (
    <Text>
      <Text color={color}>{icon} </Text>
      <Text dimColor>{label}</Text>
    </Text>
  );
}

// ── Key Legend ────────────────────────────────────────────────────────────────

function KeyLegend() {
  return (
    <Box flexDirection="column">
      <Text dimColor>{'\u2500'.repeat(14)}</Text>
      <Text dimColor>keys:</Text>
      <Text>
        <Text color="gray">i </Text>
        <Text dimColor>inspector</Text>
      </Text>
      <Text>
        <Text color="gray">q </Text>
        <Text dimColor>quit</Text>
      </Text>
    </Box>
  );
}

// ── Info Panel (left column) ─────────────────────────────────────────────────

export function InfoPanel({
  projectName,
  agent,
  version,
  height,
  fetchStatus,
  fetchCountdown,
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
}: {
  projectName: string;
  agent: string;
  version: string;
  height: number;
  fetchStatus: FetchStatus;
  fetchCountdown: number;
  coordinatorStatus: CoordinatorStatus;
  processedCount: number;
  plannerStatus: PlannerStatus;
  plannerProcessedCount: number;
  workflowRunnerStatus: WorkflowRunnerStatus;
  workflowRunnerProcessedCount: number;
  committerStatus: CommitterStatus;
  committerProcessedCount: number;
  resolverStatus: ResolverStatus;
  resolverProcessedCount: number;
  pusherStatus: PusherStatus;
  pusherProcessedCount: number;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      height={height}
    >
      <Text bold color="cyan">
        ROVER
      </Text>
      <Text bold color="cyan">
        AUTOPILOT
      </Text>
      <Text> </Text>
      <Text>
        <Text dimColor>project </Text>
        <Text color="white">{projectName}</Text>
      </Text>
      <Text>
        <Text dimColor>agent </Text>
        <Text color="white">{agent}</Text>
      </Text>
      <Text>
        <Text dimColor>version </Text>
        <Text color="white">{version}</Text>
      </Text>
      <Text> </Text>
      <FetchIndicator status={fetchStatus} countdown={fetchCountdown} />
      <CoordinatorIndicator
        status={coordinatorStatus}
        processedCount={processedCount}
      />
      <PlannerIndicator
        status={plannerStatus}
        processedCount={plannerProcessedCount}
      />
      <WorkflowRunnerIndicator
        status={workflowRunnerStatus}
        processedCount={workflowRunnerProcessedCount}
      />
      <CommitterIndicator
        status={committerStatus}
        processedCount={committerProcessedCount}
      />
      <ResolverIndicator
        status={resolverStatus}
        processedCount={resolverProcessedCount}
      />
      <PusherIndicator
        status={pusherStatus}
        processedCount={pusherProcessedCount}
      />
      <Box flexGrow={1} />
      <KeyLegend />
    </Box>
  );
}

// ── Work Boxes (compact — 2 rows) ───────────────────────────────────────────

function WorkBox({ slot }: { slot: WorkSlot }) {
  const fill = getSlotFill(slot.status);
  const color =
    slot.status === 'done'
      ? 'green'
      : slot.status === 'error'
        ? 'red'
        : slot.status === 'running'
          ? 'cyan'
          : 'gray';

  return (
    <Box flexDirection="column">
      <Text color={color}>
        [{fill}
        {fill}
        {fill}]
      </Text>
      <Text dimColor>{slot.label.padStart(4).slice(0, 5)}</Text>
    </Box>
  );
}

export function WorkBoxes({ slots }: { slots: WorkSlot[] }) {
  return (
    <Box gap={1} flexWrap="wrap">
      {slots.map(s => (
        <WorkBox key={s.id} slot={s} />
      ))}
    </Box>
  );
}

// ── Action Trace Row ─────────────────────────────────────────────────────────

const STEP_COLORS: Record<ActionStepStatus, string> = {
  completed: 'green',
  running: 'cyan',
  pending: 'gray',
  failed: 'red',
  error: 'yellow',
};

const STEP_FILLED: Record<ActionStepStatus, string> = {
  completed: '\u25A0', // ■
  running: '\u25A0', // ■
  pending: '\u25A1', // □
  failed: '\u25A0', // ■
  error: '\u25A0', // ■
};

function ActionTraceRow({ trace }: { trace: ActionTrace }) {
  return (
    <Box>
      <Box>
        {trace.steps.map((step, i) => (
          <Text key={`${step.actionId}-${i}`}>
            <Text color={STEP_COLORS[step.status]}>
              {STEP_FILLED[step.status]}
            </Text>
            {i < trace.steps.length - 1 ? (
              <Text dimColor>{'\u2500'}</Text>
            ) : null}
          </Text>
        ))}
      </Box>
      <Text> </Text>
      <Text dimColor>{trace.summary}</Text>
    </Box>
  );
}

// ── Action Trace List (for main view) ────────────────────────────────────────

export function ActionTraceList({
  traces,
  maxVisible,
}: {
  traces: ActionTrace[];
  maxVisible: number;
}) {
  if (traces.length === 0) return null;

  const visible = traces.slice(-maxVisible);

  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map(trace => (
        <ActionTraceRow key={trace.traceId} trace={trace} />
      ))}
    </Box>
  );
}

// ── Space Scene (right column) ───────────────────────────────────────────────

export function SpaceScene({
  width,
  height,
  slots,
  traces,
}: {
  width: number;
  height: number;
  slots: WorkSlot[];
  traces: ActionTrace[];
}) {
  const starsRef = useRef(createStarField(width, height));
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    // re-initialize stars when dimensions change
    starsRef.current = createStarField(width, height);
  }, [width, height]);

  useEffect(() => {
    const tick = () => {
      starsRef.current = advanceStars(starsRef.current, width, height);
      const rendered = renderStarField(starsRef.current, width, height);

      // overlay planet art near the bottom-right
      const planet = getPlanetArt();
      const planetStartRow = Math.max(0, height - planet.length - 1);
      for (let i = 0; i < planet.length; i++) {
        const row = planetStartRow + i;
        if (row < rendered.length) {
          const pLine = planet[i];
          const col = Math.max(0, width - pLine.length - 2);
          const before = rendered[row].slice(0, col);
          const after = rendered[row].slice(col + pLine.length);
          rendered[row] = before + pLine + after;
        }
      }

      setLines(rendered);
    };

    tick();
    const timer = setInterval(tick, 300);
    return () => clearInterval(timer);
  }, [width, height]);

  // Reserve rows: 3 for compact boxes + traces
  const boxRows = 3;
  const traceRows = Math.min(traces.length, 4);
  const reservedRows = boxRows + traceRows;
  const starLines = lines.slice(reservedRows);

  return (
    <Box flexDirection="column" height={height}>
      <Box height={boxRows} paddingX={1} paddingTop={1}>
        <WorkBoxes slots={slots} />
      </Box>
      {traces.length > 0 && (
        <Box height={traceRows}>
          <ActionTraceList traces={traces} maxVisible={traceRows} />
        </Box>
      )}
      <Box flexDirection="column" flexGrow={1}>
        {starLines.map((line, i) => (
          <Text key={i} dimColor>
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

// ── Log Book (bottom row) ────────────────────────────────────────────────────

export function LogBook({
  entries,
  height,
}: {
  entries: LogEntry[];
  height: number;
}) {
  // show most recent entries that fit
  const visibleCount = Math.max(1, height - 2); // account for border
  const visible = entries.slice(-visibleCount);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      height={height}
      paddingX={1}
    >
      <Text bold dimColor>
        LOG
      </Text>
      {visible.length === 0 ? (
        <Text dimColor>Waiting for events...</Text>
      ) : (
        visible.map((entry, i) => (
          <Text key={i} wrap="truncate">
            <Text dimColor>{entry.timestamp} </Text>
            <Text>{entry.message}</Text>
          </Text>
        ))
      )}
    </Box>
  );
}
