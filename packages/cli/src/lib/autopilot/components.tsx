import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import type {
  FetchStatus,
  LogEntry,
  WorkSlot,
  CoordinatorStatus,
  PlannerStatus,
  ActionChain,
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

// ── Key Legend ────────────────────────────────────────────────────────────────

function KeyLegend() {
  return (
    <Box flexDirection="column">
      <Text dimColor>{'\u2500'.repeat(14)}</Text>
      <Text dimColor>keys:</Text>
      <Text>
        <Text color="gray">ctrl+a </Text>
        <Text dimColor>actions</Text>
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

// ── Action Chain Row ─────────────────────────────────────────────────────────

const STEP_COLORS: Record<ActionStepStatus, string> = {
  completed: 'green',
  running: 'cyan',
  pending: 'gray',
  failed: 'red',
};

const STEP_FILLED: Record<ActionStepStatus, string> = {
  completed: '\u25A0', // ■
  running: '\u25A0', // ■
  pending: '\u25A1', // □
  failed: '\u25A0', // ■
};

function ActionChainRow({ chain }: { chain: ActionChain }) {
  return (
    <Box>
      <Box>
        {chain.steps.map((step, i) => (
          <Text key={step.actionId}>
            <Text color={STEP_COLORS[step.status]}>
              {STEP_FILLED[step.status]}
            </Text>
            {i < chain.steps.length - 1 ? (
              <Text dimColor>{'\u2500'}</Text>
            ) : null}
          </Text>
        ))}
      </Box>
      <Text> </Text>
      <Text dimColor>{chain.summary}</Text>
    </Box>
  );
}

// ── Action Chain List (for main view) ────────────────────────────────────────

export function ActionChainList({
  chains,
  maxVisible,
}: {
  chains: ActionChain[];
  maxVisible: number;
}) {
  if (chains.length === 0) return null;

  const visible = chains.slice(-maxVisible);

  return (
    <Box flexDirection="column" paddingX={1}>
      {visible.map(chain => (
        <ActionChainRow key={chain.chainId} chain={chain} />
      ))}
    </Box>
  );
}

// ── Actions Detail View (full-screen, CTRL+A) ───────────────────────────────

export function ActionsDetailView({
  chains,
  width,
  height,
}: {
  chains: ActionChain[];
  width: number;
  height: number;
}) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      width={width}
      height={height}
    >
      <Text bold color="cyan">
        ACTION CHAINS
      </Text>
      <Text dimColor>{'\u2500'.repeat(Math.min(14, width - 4))}</Text>
      {chains.length === 0 ? (
        <Text dimColor>No action chains yet...</Text>
      ) : (
        chains.map(chain => (
          <Box key={chain.chainId} flexDirection="column" marginBottom={1}>
            <ActionChainRow chain={chain} />
            {chain.steps.map(step => (
              <Text key={step.actionId} wrap="truncate">
                <Text> </Text>
                <Text color={STEP_COLORS[step.status]}>{step.action}</Text>
                <Text dimColor>: {step.reasoning ?? 'pending'}</Text>
              </Text>
            ))}
          </Box>
        ))
      )}
      <Box flexGrow={1} />
      <Text dimColor>press ctrl+a to return</Text>
    </Box>
  );
}

// ── Space Scene (right column) ───────────────────────────────────────────────

export function SpaceScene({
  width,
  height,
  slots,
  chains,
}: {
  width: number;
  height: number;
  slots: WorkSlot[];
  chains: ActionChain[];
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

  // Reserve rows: 3 for compact boxes + chains
  const boxRows = 3;
  const chainRows = Math.min(chains.length, 4);
  const reservedRows = boxRows + chainRows;
  const starLines = lines.slice(reservedRows);

  return (
    <Box flexDirection="column" height={height}>
      <Box height={boxRows} paddingX={1} paddingTop={1}>
        <WorkBoxes slots={slots} />
      </Box>
      {chains.length > 0 && (
        <Box height={chainRows}>
          <ActionChainList chains={chains} maxVisible={chainRows} />
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
