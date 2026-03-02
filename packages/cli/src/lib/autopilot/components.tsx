import { Box, Text } from 'ink';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { progressBar, timeAgo } from './helpers.js';
import type {
  ActionStepStatus,
  ActionTrace,
  LogEntry,
  TaskInfo,
} from './types.js';

// ── Shared Color Maps (exported for inspector) ─────────────────────────────

export const STEP_COLORS: Record<ActionStepStatus, string> = {
  completed: 'green',
  running: 'cyan',
  pending: 'gray',
  failed: 'red',
  error: 'yellow',
};

export const STEP_FILLED: Record<ActionStepStatus, string> = {
  completed: '\u25A0', // ■
  running: '\u25A0',
  pending: '\u25A1', // □
  failed: '\u25A0',
  error: '\u25A0',
};

export const STEP_TERMINAL: Record<ActionStepStatus, string> = {
  completed: '\u25CF', // ●
  running: '\u25CF',
  pending: '\u25CB', // ○
  failed: '\u25CF',
  error: '\u25CF',
};

export const TASK_STATUS_COLORS: Record<string, string> = {
  IN_PROGRESS: 'cyan',
  ITERATING: 'cyan',
  COMPLETED: 'green',
  MERGED: 'green',
  PUSHED: 'green',
  FAILED: 'red',
  PENDING: 'gray',
  NEW: 'gray',
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  IN_PROGRESS: 'RUNNING',
  ITERATING: 'RUNNING',
  COMPLETED: 'DONE',
  MERGED: 'DONE',
  PUSHED: 'PUSHED',
  FAILED: 'FAILED',
  PENDING: 'PENDING',
  NEW: 'NEW',
};

// ── Rover Header ────────────────────────────────────────────────────────────

const TEAL_600 = '#0d9488';
const TEAL_400 = '#2dd4bf';

export const RoverHeader = React.memo(function RoverHeader({
  version,
  agent,
  projectName,
  coordinatorActive,
  workflowActive,
  resolverActive,
}: {
  version: string;
  agent: string;
  projectName: string;
  coordinatorActive: boolean;
  workflowActive: boolean;
  resolverActive: boolean;
}) {
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Box>
        {/* Left: ASCII art + info */}
        <Box flexDirection="column">
          <Box>
            <Text color={TEAL_600}>
              {' \u256D\u2550\u2550\u2550\u2550\u256E  '}
            </Text>
            <Text bold>{'Rover '}</Text>
            <Text dimColor>{'\u00B7 '}</Text>
            <Text dimColor>{`v${version}`}</Text>
          </Box>
          <Box>
            <Text color={TEAL_600}>{'\u2759\u2502 '}</Text>
            <Text color={TEAL_400}>{'\u2588\u2588'}</Text>
            <Text color={TEAL_600}>{' \u2502\u2759 '}</Text>
            <Text>{agent}</Text>
          </Box>
          <Box>
            <Text color={TEAL_600}>
              {' \u2570\u2550\u2550\u2550\u2550\u256F  '}
            </Text>
            <Text color="cyan">{'\u25C8 '}</Text>
            <Text color="cyan">{projectName}</Text>
          </Box>
        </Box>
        <Box flexGrow={1} />
        {/* Right: status box */}
        <Box borderStyle="round" borderColor="gray" paddingX={1}>
          <Text>{'status '}</Text>
          <Text color={coordinatorActive ? 'cyan' : 'gray'}>
            {coordinatorActive ? '\u25CF' : '\u25CB'}
          </Text>
          <Text> </Text>
          <Text color={workflowActive ? 'blue' : 'gray'}>
            {workflowActive ? '\u25CF' : '\u25CB'}
          </Text>
          <Text> </Text>
          <Text color={resolverActive ? 'yellow' : 'gray'}>
            {resolverActive ? '\u25CF' : '\u25CB'}
          </Text>
        </Box>
      </Box>
      <Text> </Text>
    </Box>
  );
});

// ── Section Header ──────────────────────────────────────────────────────────

export const SectionHeader = React.memo(function SectionHeader({
  title,
  width,
}: {
  title: string;
  width: number;
}) {
  const lineLen = Math.max(1, width - title.length - 2);
  return (
    <Box>
      <Text dimColor>{` ${title} `}</Text>
      <Text dimColor>{'\u2500'.repeat(lineLen)}</Text>
    </Box>
  );
});

// ── Action Trace Row ────────────────────────────────────────────────────────

const ActionTraceRow = React.memo(function ActionTraceRow({
  trace,
}: {
  trace: ActionTrace;
}) {
  const age = timeAgo(trace.createdAt);
  return (
    <Box>
      <Text> </Text>
      <Box>
        {trace.steps.map((step, i) => (
          <Text key={`${step.originAction ?? step.spanId ?? i}-${i}`}>
            <Text color={STEP_COLORS[step.status]}>
              {step.terminal
                ? STEP_TERMINAL[step.status]
                : STEP_FILLED[step.status]}
            </Text>
            {i < trace.steps.length - 1 ? (
              <Text dimColor>{'\u2500'}</Text>
            ) : null}
          </Text>
        ))}
      </Box>
      <Text>{'  '}</Text>
      <Box flexGrow={1}>
        <Text dimColor wrap="truncate">
          {trace.summary}
        </Text>
      </Box>
      <Text dimColor>{` ${age.padStart(8)}`}</Text>
    </Box>
  );
});

// ── Traces Section ──────────────────────────────────────────────────────────

export const TracesSection = React.memo(function TracesSection({
  traces,
  maxVisible,
}: {
  traces: ActionTrace[];
  maxVisible: number;
}) {
  const sorted = useMemo(() => {
    return [...traces]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, maxVisible);
  }, [traces, maxVisible]);

  if (sorted.length === 0) {
    return <Text dimColor>{' Waiting for events...'}</Text>;
  }

  return (
    <Box flexDirection="column">
      {sorted.map(trace => (
        <ActionTraceRow key={trace.traceId} trace={trace} />
      ))}
    </Box>
  );
});

// ── Star Field ──────────────────────────────────────────────────────────────

const STAR_WIDTH = 20;

// 0 = empty, 1+ = star variant index
type StarCell = number;

interface StarVariant {
  char: string;
  color: string | undefined;
}

const STAR_VARIANTS: StarVariant[] = [
  { char: '\u00B7', color: undefined }, //  ·  dim white
  { char: '\u00B7', color: '#6b7280' }, //  ·  grey
  { char: '.', color: '#4b5563' }, //  .  dark grey
  { char: '+', color: '#7dd3fc' }, //  +  sky blue
  { char: '*', color: undefined }, //  *  dim white
  { char: '*', color: '#c4b5fd' }, //  *  violet
  { char: '\u2022', color: '#fbbf24' }, //  •  amber
  { char: '\u2219', color: '#0d9488' }, //  ∙  teal
  { char: '\u2734', color: '#f9a8d4' }, //  ✴  pink
  { char: '\u2726', color: '#93c5fd' }, //  ✦  blue
];

interface StarLayer {
  density: number;
  variants: number[]; // indices into STAR_VARIANTS
  interval: number;
}

const LAYERS: StarLayer[] = [
  { density: 0.04, variants: [0, 1, 2, 3], interval: 2000 }, // far, slow
  { density: 0.02, variants: [4, 5, 6, 7, 8, 9], interval: 1200 }, // near, fast
];

function randomColumn(rows: number, layer: StarLayer): StarCell[] {
  return Array.from({ length: rows }, () => {
    if (Math.random() >= layer.density) return 0;
    return (
      layer.variants[Math.floor(Math.random() * layer.variants.length)]! + 1
    );
  });
}

function buildGrid(rows: number, cols: number, layer: StarLayer): StarCell[][] {
  return Array.from({ length: cols }, () => randomColumn(rows, layer));
}

function shiftGrid(
  grid: StarCell[][],
  rows: number,
  layer: StarLayer
): StarCell[][] {
  return [...grid.slice(1), randomColumn(rows, layer)];
}

export const StarField = React.memo(function StarField({
  height,
}: {
  height: number;
}) {
  const gridsRef = useRef(LAYERS.map(l => buildGrid(height, STAR_WIDTH, l)));
  const [grids, setGrids] = useState(() => gridsRef.current);

  useEffect(() => {
    const timers = LAYERS.map((layer, idx) =>
      setInterval(() => {
        const next = shiftGrid(gridsRef.current[idx]!, height, layer);
        gridsRef.current = gridsRef.current.map((g, i) =>
          i === idx ? next : g
        );
        setGrids([...gridsRef.current]);
      }, layer.interval)
    );
    return () => timers.forEach(clearInterval);
  }, [height]);

  const cells = useMemo(
    () =>
      Array.from({ length: height }, (_, row) => {
        const line: StarCell[] = [];
        for (let col = 0; col < STAR_WIDTH; col++) {
          let cell: StarCell = 0;
          for (let l = LAYERS.length - 1; l >= 0; l--) {
            const v = grids[l]?.[col]?.[row] ?? 0;
            if (v > 0) {
              cell = v;
              break;
            }
          }
          line.push(cell);
        }
        return line;
      }),
    [grids, height]
  );

  return (
    <Box flexDirection="column" width={STAR_WIDTH}>
      {cells.map((line, i) => (
        <Text key={i} dimColor>
          {line.map((cell, j) => {
            if (cell === 0) return ' ';
            const v = STAR_VARIANTS[cell - 1]!;
            return v.color ? (
              <Text key={j} color={v.color} dimColor>
                {v.char}
              </Text>
            ) : (
              v.char
            );
          })}
        </Text>
      ))}
    </Box>
  );
});

// ── Task Row ────────────────────────────────────────────────────────────────

const TaskRow = React.memo(function TaskRow({
  task,
  width,
}: {
  task: TaskInfo;
  width: number;
}) {
  const statusLabel = TASK_STATUS_LABELS[task.status] ?? task.status;
  const statusColor = TASK_STATUS_COLORS[task.status] ?? 'gray';
  const barWidth = 10;
  const bar = progressBar(task.progress, barWidth);
  const titleMaxLen = Math.max(10, width - 58);

  return (
    <Box>
      <Text dimColor>{` #${String(task.id).padEnd(3)}`}</Text>
      <Text color={statusColor} bold>
        {` ${statusLabel.padEnd(9)}`}
      </Text>
      <Text dimColor>{` ${task.agent.padEnd(16)}`}</Text>
      <Text wrap="truncate">{` ${task.title.slice(0, titleMaxLen)}`}</Text>
      <Box flexGrow={1} />
      <Text color={task.progress >= 100 ? 'green' : 'cyan'}>{` ${bar}`}</Text>
      <Text>{` ${String(task.progress).padStart(3)}%`}</Text>
      <Text dimColor>{` ${task.duration.padStart(6)}`}</Text>
    </Box>
  );
});

// ── Tasks Section ───────────────────────────────────────────────────────────

export const TasksSection = React.memo(function TasksSection({
  tasks,
  maxVisible,
  width,
}: {
  tasks: TaskInfo[];
  maxVisible: number;
  width: number;
}) {
  const visible = useMemo(
    () => tasks.slice(0, maxVisible),
    [tasks, maxVisible]
  );

  if (visible.length === 0) {
    return <Text dimColor>{' No tasks'}</Text>;
  }

  return (
    <Box flexDirection="column">
      {visible.map(task => (
        <TaskRow key={task.id} task={task} width={width} />
      ))}
    </Box>
  );
});

// ── Log Book ────────────────────────────────────────────────────────────────

const LOG_BG = '#000000';

export const LogBook = React.memo(function LogBook({
  entries,
  height,
  width,
}: {
  entries: LogEntry[];
  height: number;
  width: number;
}) {
  const visible = useMemo(() => entries.slice(-height), [entries, height]);
  const emptyRows = Math.max(0, height - Math.max(1, visible.length));
  const fill = ' '.repeat(width);

  return (
    <Box flexDirection="column" height={height}>
      {visible.length === 0 ? (
        <Text backgroundColor={LOG_BG}>
          <Text dimColor>{' Waiting for events...'}</Text>
          <Text>{fill}</Text>
        </Text>
      ) : (
        visible.map((entry, i) => (
          <Text key={i} wrap="truncate" backgroundColor={LOG_BG}>
            <Text dimColor>{` ${entry.timestamp} `}</Text>
            <Text>{entry.message}</Text>
            <Text>{fill}</Text>
          </Text>
        ))
      )}
      {Array.from({ length: emptyRows }, (_, i) => (
        <Text key={`pad-${i}`} backgroundColor={LOG_BG}>
          {fill}
        </Text>
      ))}
    </Box>
  );
});

// ── Key Legend ───────────────────────────────────────────────────────────────

export const KeyLegend = React.memo(function KeyLegend() {
  return (
    <Box>
      <Text dimColor>{'Keys / i:inspector  q:quit'}</Text>
    </Box>
  );
});
