import React, {
  useReducer,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { Box, Text, useInput } from 'ink';
import type {
  Action,
  ActionTrace,
  ActionStep,
  ActionStepStatus,
  AutopilotLogEntry,
  PendingAction,
  TaskInfo,
  TaskMapping,
  Span,
} from './types.js';
import type { AutopilotStore } from './store.js';
import {
  STEP_COLORS,
  STEP_FILLED,
  STEP_TERMINAL,
  TASK_STATUS_COLORS,
  TASK_STATUS_LABELS,
  SectionHeader,
} from './components.js';
import { timeAgo, progressBar } from './helpers.js';

// ── Types ───────────────────────────────────────────────────────────────────

type InspectorTab = 'traces' | 'logs' | 'pending' | 'tasks';
type TraceFilter = 'all' | 'active' | 'completed' | 'failed';
type LogStepFilter = string | null;

interface InspectorState {
  activeTab: InspectorTab;
  // Traces
  traceSelectedIndex: number;
  traceSelectedId: string | null;
  traceDrillDown: boolean;
  traceDetailScroll: number;
  traceFilter: TraceFilter;
  traceStepSelectedIndex: number;
  traceStepDrillDown: boolean;
  traceStepDetailScroll: number;
  // Logs
  logScroll: number;
  logSearch: string;
  logSearchActive: boolean;
  logStepFilter: LogStepFilter;
  // Pending
  pendingSelectedIndex: number;
  pendingDrillDown: boolean;
  // Tasks
  taskSelectedIndex: number;
  taskSelectedActionId: string | null;
  taskDrillDown: boolean;
  taskDetailScroll: number;
}

type InspectorAction =
  | { type: 'SET_TAB'; tab: InspectorTab }
  | { type: 'NEXT_TAB' }
  | { type: 'PREV_TAB' }
  | { type: 'MOVE_UP' }
  | { type: 'MOVE_DOWN'; maxIndex: number }
  | { type: 'ENTER'; traceId?: string; taskActionId?: string }
  | { type: 'ESCAPE' }
  | { type: 'CYCLE_TRACE_FILTER' }
  | { type: 'TOGGLE_LOG_SEARCH' }
  | { type: 'LOG_SEARCH_CHAR'; char: string }
  | { type: 'LOG_SEARCH_BACKSPACE' }
  | { type: 'CYCLE_LOG_STEP_FILTER' }
  | { type: 'SCROLL_UP' }
  | { type: 'SCROLL_DOWN'; maxScroll: number };

const TABS: InspectorTab[] = ['traces', 'logs', 'pending', 'tasks'];
const TRACE_FILTERS: TraceFilter[] = ['all', 'active', 'completed', 'failed'];
const LOG_STEP_FILTERS: (string | null)[] = [
  null,
  'event',
  'coordinate',
  'plan',
  'workflow',
  'commit',
  'resolve',
];

// ── Colors ──────────────────────────────────────────────────────────────────

const LOG_STEP_COLORS: Record<string, string> = {
  event: 'yellow',
  coordinate: 'cyan',
  plan: 'magenta',
  workflow: 'blue',
  commit: 'green',
  resolve: 'yellow',
};

const LOG_BG = '#000000';

// ── State ───────────────────────────────────────────────────────────────────

function initialState(): InspectorState {
  return {
    activeTab: 'traces',
    traceSelectedIndex: 0,
    traceSelectedId: null,
    traceDrillDown: false,
    traceDetailScroll: 0,
    traceFilter: 'all',
    traceStepSelectedIndex: 0,
    traceStepDrillDown: false,
    traceStepDetailScroll: 0,
    logScroll: -1,
    logSearch: '',
    logSearchActive: false,
    logStepFilter: null,
    pendingSelectedIndex: 0,
    pendingDrillDown: false,
    taskSelectedIndex: 0,
    taskSelectedActionId: null,
    taskDrillDown: false,
    taskDetailScroll: 0,
  };
}

function inspectorReducer(
  state: InspectorState,
  action: InspectorAction
): InspectorState {
  switch (action.type) {
    case 'SET_TAB':
      return { ...state, activeTab: action.tab };

    case 'NEXT_TAB': {
      const idx = TABS.indexOf(state.activeTab);
      return { ...state, activeTab: TABS[(idx + 1) % TABS.length] };
    }

    case 'PREV_TAB': {
      const idx = TABS.indexOf(state.activeTab);
      return {
        ...state,
        activeTab: TABS[(idx - 1 + TABS.length) % TABS.length],
      };
    }

    case 'MOVE_UP':
      if (state.activeTab === 'traces') {
        if (state.traceDrillDown) {
          if (state.traceStepDrillDown)
            return {
              ...state,
              traceStepDetailScroll: Math.max(
                0,
                state.traceStepDetailScroll - 1
              ),
            };
          return {
            ...state,
            traceStepSelectedIndex: Math.max(
              0,
              state.traceStepSelectedIndex - 1
            ),
          };
        }
        return {
          ...state,
          traceSelectedIndex: Math.max(0, state.traceSelectedIndex - 1),
        };
      }
      if (state.activeTab === 'logs')
        return { ...state, logScroll: Math.max(0, state.logScroll - 1) };
      if (state.activeTab === 'pending') {
        if (state.pendingDrillDown) return state;
        return {
          ...state,
          pendingSelectedIndex: Math.max(0, state.pendingSelectedIndex - 1),
        };
      }
      if (state.activeTab === 'tasks') {
        if (state.taskDrillDown)
          return {
            ...state,
            taskDetailScroll: Math.max(0, state.taskDetailScroll - 1),
          };
        return {
          ...state,
          taskSelectedIndex: Math.max(0, state.taskSelectedIndex - 1),
        };
      }
      return state;

    case 'MOVE_DOWN':
      if (state.activeTab === 'traces') {
        if (state.traceDrillDown) {
          if (state.traceStepDrillDown)
            return {
              ...state,
              traceStepDetailScroll: Math.min(
                action.maxIndex,
                state.traceStepDetailScroll + 1
              ),
            };
          return {
            ...state,
            traceStepSelectedIndex: Math.min(
              action.maxIndex,
              state.traceStepSelectedIndex + 1
            ),
          };
        }
        return {
          ...state,
          traceSelectedIndex: Math.min(
            action.maxIndex,
            state.traceSelectedIndex + 1
          ),
        };
      }
      if (state.activeTab === 'logs')
        return {
          ...state,
          logScroll: Math.min(action.maxIndex, state.logScroll + 1),
        };
      if (state.activeTab === 'pending') {
        if (state.pendingDrillDown) return state;
        return {
          ...state,
          pendingSelectedIndex: Math.min(
            action.maxIndex,
            state.pendingSelectedIndex + 1
          ),
        };
      }
      if (state.activeTab === 'tasks') {
        if (state.taskDrillDown)
          return {
            ...state,
            taskDetailScroll: Math.min(
              action.maxIndex,
              state.taskDetailScroll + 1
            ),
          };
        return {
          ...state,
          taskSelectedIndex: Math.min(
            action.maxIndex,
            state.taskSelectedIndex + 1
          ),
        };
      }
      return state;

    case 'ENTER':
      if (state.activeTab === 'traces' && !state.traceDrillDown)
        return {
          ...state,
          traceDrillDown: true,
          traceDetailScroll: 0,
          traceSelectedId: action.traceId ?? null,
          traceStepSelectedIndex: 0,
          traceStepDrillDown: false,
          traceStepDetailScroll: 0,
        };
      if (
        state.activeTab === 'traces' &&
        state.traceDrillDown &&
        !state.traceStepDrillDown
      )
        return {
          ...state,
          traceStepDrillDown: true,
          traceStepDetailScroll: 0,
        };
      if (state.activeTab === 'pending' && !state.pendingDrillDown)
        return { ...state, pendingDrillDown: true };
      if (state.activeTab === 'tasks' && !state.taskDrillDown)
        return {
          ...state,
          taskDrillDown: true,
          taskDetailScroll: 0,
          taskSelectedActionId: action.taskActionId ?? null,
        };
      return state;

    case 'ESCAPE':
      if (state.activeTab === 'traces' && state.traceDrillDown) {
        if (state.traceStepDrillDown)
          return { ...state, traceStepDrillDown: false };
        return {
          ...state,
          traceDrillDown: false,
          traceSelectedId: null,
          traceStepSelectedIndex: 0,
        };
      }
      if (state.activeTab === 'logs' && state.logSearchActive)
        return { ...state, logSearchActive: false, logSearch: '' };
      if (state.activeTab === 'pending' && state.pendingDrillDown)
        return { ...state, pendingDrillDown: false };
      if (state.activeTab === 'tasks' && state.taskDrillDown)
        return {
          ...state,
          taskDrillDown: false,
          taskSelectedActionId: null,
        };
      return state;

    case 'CYCLE_TRACE_FILTER': {
      const idx = TRACE_FILTERS.indexOf(state.traceFilter);
      return {
        ...state,
        traceFilter: TRACE_FILTERS[(idx + 1) % TRACE_FILTERS.length],
        traceSelectedIndex: 0,
      };
    }

    case 'TOGGLE_LOG_SEARCH':
      return {
        ...state,
        logSearchActive: !state.logSearchActive,
        logSearch: state.logSearchActive ? '' : state.logSearch,
      };

    case 'LOG_SEARCH_CHAR':
      return { ...state, logSearch: state.logSearch + action.char };

    case 'LOG_SEARCH_BACKSPACE':
      return { ...state, logSearch: state.logSearch.slice(0, -1) };

    case 'CYCLE_LOG_STEP_FILTER': {
      const idx = LOG_STEP_FILTERS.indexOf(state.logStepFilter);
      return {
        ...state,
        logStepFilter: LOG_STEP_FILTERS[(idx + 1) % LOG_STEP_FILTERS.length],
      };
    }

    case 'SCROLL_UP':
      if (state.activeTab === 'logs')
        return { ...state, logScroll: Math.max(0, state.logScroll - 1) };
      return state;

    case 'SCROLL_DOWN':
      if (state.activeTab === 'logs')
        return {
          ...state,
          logScroll: Math.min(action.maxScroll, state.logScroll + 1),
        };
      return state;

    default:
      return state;
  }
}

// ── Utility ─────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
  } catch {
    return ts.slice(11, 19);
  }
}

function filterTraces(
  traces: ActionTrace[],
  filter: TraceFilter
): ActionTrace[] {
  if (filter === 'all') return traces;
  return traces.filter(trace => {
    const hasRunningOrPending = trace.steps.some(
      s => s.status === 'running' || s.status === 'pending'
    );
    const hasFailed = trace.steps.some(
      s => s.status === 'failed' || s.status === 'error'
    );
    const allCompleted = trace.steps.every(s => s.status === 'completed');

    if (filter === 'active') return hasRunningOrPending;
    if (filter === 'completed') return allCompleted;
    if (filter === 'failed') return hasFailed;
    return true;
  });
}

// ── Sub-Components ──────────────────────────────────────────────────────────

const InspectorTabs = React.memo(function InspectorTabs({
  activeTab,
}: {
  activeTab: InspectorTab;
}) {
  return (
    <Box gap={1}>
      <Text bold color="cyan">
        INSPECTOR
      </Text>
      <Text dimColor>{'  '}</Text>
      {TABS.map(tab => (
        <Text
          key={tab}
          bold={tab === activeTab}
          color={tab === activeTab ? 'cyan' : 'gray'}
        >
          {tab === activeTab ? `[${tab.toUpperCase()}]` : `  ${tab}  `}
        </Text>
      ))}
    </Box>
  );
});

const InspectorFooter = React.memo(function InspectorFooter({
  activeTab,
  state,
}: {
  activeTab: InspectorTab;
  state: InspectorState;
}) {
  const parts: string[] = ['\u21B9:tab', '\u2191\u2193:nav'];

  if (activeTab === 'traces') {
    if (state.traceDrillDown && state.traceStepDrillDown) {
      parts.push('Esc:back');
    } else if (state.traceDrillDown) {
      parts.push('\u21B5:step', 'Esc:back');
    } else {
      parts.push('\u21B5:detail', 'f:filter');
    }
  }

  if (activeTab === 'logs') {
    parts.push('/:search', 's:step');
  }

  if (activeTab === 'pending') {
    parts.push(state.pendingDrillDown ? 'Esc:back' : '\u21B5:detail');
  }

  if (activeTab === 'tasks') {
    parts.push(state.taskDrillDown ? 'Esc:back' : '\u21B5:detail');
  }

  parts.push('i:close');

  return (
    <Box>
      <Text dimColor>{parts.join('  ')}</Text>
    </Box>
  );
});

// ── Traces Panel ────────────────────────────────────────────────────────────

const TracesListView = React.memo(function TracesListView({
  traces,
  selectedIndex,
  filter,
  visibleHeight,
}: {
  traces: ActionTrace[];
  selectedIndex: number;
  filter: TraceFilter;
  visibleHeight: number;
}) {
  const sorted = useMemo(() => {
    const filtered = filterTraces(traces, filter);
    return [...filtered].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [traces, filter]);

  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(visibleHeight / 2),
      Math.max(0, sorted.length - visibleHeight)
    )
  );
  const visible = sorted.slice(startIndex, startIndex + visibleHeight);

  return (
    <Box flexDirection="column">
      <Box gap={2}>
        <Text dimColor>
          {' '}
          Filter: <Text color="yellow">{filter}</Text> (f)
        </Text>
        <Text dimColor>
          {sorted.length} trace{sorted.length !== 1 ? 's' : ''}
        </Text>
      </Box>
      {sorted.length === 0 ? (
        <Text dimColor> No traces match filter</Text>
      ) : (
        visible.map((trace, i) => {
          const realIndex = startIndex + i;
          const isSelected = realIndex === selectedIndex;
          const age = timeAgo(trace.createdAt);
          return (
            <Box key={trace.traceId}>
              <Text color={isSelected ? 'cyan' : undefined}>
                {isSelected ? ' \u25B8 ' : '   '}
              </Text>
              <Box>
                {trace.steps.map((step, si) => (
                  <Text key={`${step.actionId}-${si}`}>
                    <Text color={STEP_COLORS[step.status]}>
                      {step.terminal
                        ? STEP_TERMINAL[step.status]
                        : STEP_FILLED[step.status]}
                    </Text>
                    {si < trace.steps.length - 1 ? (
                      <Text dimColor>{'\u2500'}</Text>
                    ) : null}
                  </Text>
                ))}
              </Box>
              <Text>{'  '}</Text>
              <Box flexGrow={1}>
                <Text
                  color={isSelected ? 'white' : undefined}
                  dimColor={!isSelected}
                  wrap="truncate"
                >
                  {trace.summary}
                </Text>
              </Box>
              <Text dimColor>{` ${age.padStart(8)}`}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
});

// Build the display list for trace steps.
interface DisplayStep {
  label: string;
  status: ActionStepStatus;
  reasoning?: string;
  terminal?: boolean;
}

function buildDisplaySteps(trace: ActionTrace): DisplayStep[] {
  const display: DisplayStep[] = [
    { label: 'event', status: 'completed', reasoning: trace.summary },
  ];
  for (const step of trace.steps) {
    display.push({
      label: step.action,
      status: step.status,
      reasoning: step.reasoning,
      terminal: !!step.terminal,
    });
  }
  return display;
}

function loadStepData(
  di: number,
  trace: ActionTrace,
  store: AutopilotStore,
  cache: Map<string, Action | null>
): { span: Span | null; actionData: Action | null } {
  if (di > 0) {
    const traceStep = trace.steps[di - 1];

    if (traceStep?.terminal && traceStep.spanId) {
      const span = store.readSpan(traceStep.spanId);
      return { span, actionData: null };
    }

    if (traceStep?.spanId) {
      const span = store.readSpan(traceStep.spanId);
      let actionData: Action | null = null;
      if (di < trace.steps.length) {
        const nextActionId = trace.steps[di].actionId;
        if (!cache.has(nextActionId)) {
          cache.set(nextActionId, store.readAction(nextActionId));
        }
        actionData = cache.get(nextActionId) ?? null;
      }
      return { span, actionData };
    }
  }

  if (di < trace.steps.length) {
    const actionId = trace.steps[di].actionId;
    if (!cache.has(actionId)) {
      cache.set(actionId, store.readAction(actionId));
    }
    const actionData = cache.get(actionId) ?? null;
    const span = actionData?.spanId ? store.readSpan(actionData.spanId) : null;
    return { span, actionData };
  }
  return { span: null, actionData: null };
}

function StepDetailView({
  stepLabel,
  stepStatus,
  displayIndex,
  actionData,
  span,
  scroll,
  visibleHeight,
  width,
}: {
  stepLabel: string;
  stepStatus: ActionStepStatus;
  displayIndex: number;
  actionData: Action | null;
  span: Span | null;
  scroll: number;
  visibleHeight: number;
  width: number;
}) {
  const lines: React.ReactNode[] = [];
  const sep = '\u2500'.repeat(Math.max(1, width - 4));

  // Header — human-readable summary first
  lines.push(
    <Text key="h1" bold>
      <Text>{` Step #${displayIndex + 1}: `}</Text>
      <Text color={STEP_COLORS[stepStatus]}>{stepLabel}</Text>
      <Text dimColor>{` (${stepStatus})`}</Text>
    </Text>
  );

  // Summary (most useful info first)
  if (span?.summary) {
    lines.push(
      <Text key="summary" wrap="truncate">
        <Text dimColor>{' Summary: '}</Text>
        <Text>{span.summary}</Text>
      </Text>
    );
  }
  if (actionData?.reasoning) {
    lines.push(
      <Text key="reasoning" wrap="truncate">
        <Text dimColor>{' Reasoning: '}</Text>
        <Text>{actionData.reasoning}</Text>
      </Text>
    );
  }

  lines.push(
    <Text key="sep1" dimColor>
      {` ${sep}`}
    </Text>
  );

  // Span details
  if (span) {
    lines.push(
      <Text key="span-title" bold>
        {' SPAN'}
      </Text>
    );
    lines.push(
      <Text key="span-step">
        <Text dimColor>{' Step: '}</Text>
        <Text>{span.step}</Text>
        {span.status ? (
          <Text>
            <Text dimColor>{'  Status: '}</Text>
            <Text
              color={
                span.status === 'completed'
                  ? 'green'
                  : span.status === 'failed'
                    ? 'red'
                    : span.status === 'error'
                      ? 'yellow'
                      : 'cyan'
              }
            >
              {span.status}
            </Text>
          </Text>
        ) : null}
      </Text>
    );
    lines.push(
      <Text key="span-ts">
        <Text dimColor>{' Created: '}</Text>
        <Text>{span.timestamp}</Text>
        {span.completed ? (
          <Text>
            <Text dimColor>{'  Completed: '}</Text>
            <Text>{span.completed}</Text>
          </Text>
        ) : null}
      </Text>
    );
    lines.push(
      <Text key="span-id">
        <Text dimColor>{' ID: '}</Text>
        <Text dimColor>{span.id}</Text>
        {span.parent ? (
          <Text>
            <Text dimColor>{'  Parent: '}</Text>
            <Text dimColor>{span.parent}</Text>
          </Text>
        ) : null}
      </Text>
    );

    if (span.meta && Object.keys(span.meta).length > 0) {
      lines.push(
        <Text key="span-meta-title" bold>
          {' SPAN META'}
        </Text>
      );
      const metaStr = JSON.stringify(span.meta, null, 2);
      const metaLines = metaStr.split('\n');
      for (let mi = 0; mi < metaLines.length; mi++) {
        lines.push(
          <Text key={`span-meta-${mi}`} dimColor wrap="truncate">
            {'  '}
            {metaLines[mi]}
          </Text>
        );
      }
    }
  } else {
    lines.push(
      <Text key="no-span" dimColor>
        {' Span not yet available'}
      </Text>
    );
  }

  // Output action
  lines.push(
    <Text key="sep2" dimColor>
      {` ${sep}`}
    </Text>
  );
  if (actionData) {
    lines.push(
      <Text key="action-title" bold>
        {' OUTPUT ACTION'}
      </Text>
    );
    lines.push(
      <Text key="action-action">
        <Text dimColor>{' Action: '}</Text>
        <Text>{actionData.action}</Text>
        <Text dimColor>{'  '}</Text>
        <Text dimColor>{actionData.timestamp}</Text>
      </Text>
    );
    lines.push(
      <Text key="action-id">
        <Text dimColor>{' ID: '}</Text>
        <Text dimColor>{actionData.id}</Text>
      </Text>
    );

    if (actionData.meta && Object.keys(actionData.meta).length > 0) {
      lines.push(
        <Text key="action-meta-title" bold>
          {' ACTION META'}
        </Text>
      );
      const metaStr = JSON.stringify(actionData.meta, null, 2);
      const metaLines = metaStr.split('\n');
      for (let mi = 0; mi < metaLines.length; mi++) {
        lines.push(
          <Text key={`action-meta-${mi}`} dimColor wrap="truncate">
            {'  '}
            {metaLines[mi]}
          </Text>
        );
      }
    }
  } else {
    lines.push(
      <Text key="no-action" dimColor>
        {' Output action not yet available'}
      </Text>
    );
  }

  const sliced = lines.slice(scroll, scroll + visibleHeight);
  return (
    <Box flexDirection="column" height={visibleHeight}>
      {sliced.map((line, i) => (
        <Box key={`row-${i}`}>{line}</Box>
      ))}
    </Box>
  );
}

function TracesDetailView({
  trace,
  selectedStepIndex,
  stepDrillDown,
  stepDetailScroll,
  store,
  visibleHeight,
  width,
}: {
  trace: ActionTrace;
  selectedStepIndex: number;
  stepDrillDown: boolean;
  stepDetailScroll: number;
  store: AutopilotStore;
  visibleHeight: number;
  width: number;
}) {
  const actionCache = useRef<Map<string, Action | null>>(new Map());
  const displaySteps = buildDisplaySteps(trace);

  if (stepDrillDown && displaySteps[selectedStepIndex]) {
    const ds = displaySteps[selectedStepIndex];
    const { span, actionData } = loadStepData(
      selectedStepIndex,
      trace,
      store,
      actionCache.current
    );

    return (
      <StepDetailView
        stepLabel={ds.label}
        stepStatus={ds.status}
        displayIndex={selectedStepIndex}
        actionData={actionData}
        span={span}
        scroll={stepDetailScroll}
        visibleHeight={visibleHeight}
        width={width}
      />
    );
  }

  const lines: React.ReactNode[] = [];

  // Human-readable header
  lines.push(
    <Text key="h1" bold>
      {' '}
      {trace.summary}
    </Text>
  );
  lines.push(
    <Text key="h2" dimColor>
      {' '}
      {timeAgo(trace.createdAt)}
      {trace.retryCount ? ` \u00B7 ${trace.retryCount} retries` : ''}
    </Text>
  );
  lines.push(
    <Text key="sep1" dimColor>
      {` ${'\u2500'.repeat(Math.max(1, width - 4))}`}
    </Text>
  );

  // Steps
  displaySteps.forEach((ds, i) => {
    const isSelected = i === selectedStepIndex;
    const color = STEP_COLORS[ds.status];
    lines.push(
      <Text key={`step-${i}`} wrap="truncate">
        <Text color={isSelected ? 'cyan' : undefined}>
          {isSelected ? ' \u25B8 ' : '   '}
        </Text>
        <Text color={color}>
          {ds.terminal ? STEP_TERMINAL[ds.status] : STEP_FILLED[ds.status]}
        </Text>
        <Text color={color}>{` ${ds.label.padEnd(12)}`}</Text>
        <Text dimColor={!isSelected}>
          {`${ds.status.padEnd(10)} ${ds.reasoning ?? 'pending'}`}
        </Text>
      </Text>
    );
  });

  const headerLines = 3;
  const selectedLinePos = headerLines + selectedStepIndex;
  const idealStart = Math.max(
    0,
    selectedLinePos - Math.floor(visibleHeight / 2)
  );
  const maxStart = Math.max(0, lines.length - visibleHeight);
  const start = Math.min(idealStart, maxStart);
  const sliced = lines.slice(start, start + visibleHeight);

  return (
    <Box flexDirection="column" height={visibleHeight}>
      {sliced.map((line, i) => (
        <Box key={`row-${i}`}>{line}</Box>
      ))}
    </Box>
  );
}

const TracesPanel = React.memo(function TracesPanel({
  traces,
  store,
  state,
  visibleHeight,
  width,
}: {
  traces: ActionTrace[];
  store: AutopilotStore;
  state: InspectorState;
  visibleHeight: number;
  width: number;
}) {
  const selectedTrace = state.traceDrillDown
    ? (traces.find(c => c.traceId === state.traceSelectedId) ?? null)
    : null;

  if (state.traceDrillDown && selectedTrace) {
    return (
      <TracesDetailView
        trace={selectedTrace}
        selectedStepIndex={state.traceStepSelectedIndex}
        stepDrillDown={state.traceStepDrillDown}
        stepDetailScroll={state.traceStepDetailScroll}
        store={store}
        visibleHeight={visibleHeight}
        width={width}
      />
    );
  }

  return (
    <TracesListView
      traces={traces}
      selectedIndex={state.traceSelectedIndex}
      filter={state.traceFilter}
      visibleHeight={visibleHeight - 1}
    />
  );
});

// ── Logs Panel ──────────────────────────────────────────────────────────────

const LogsPanel = React.memo(function LogsPanel({
  store,
  state,
  visibleHeight,
  width,
}: {
  store: AutopilotStore;
  state: InspectorState;
  visibleHeight: number;
  width: number;
}) {
  const [logs, setLogs] = React.useState<AutopilotLogEntry[]>([]);

  useEffect(() => {
    const load = () => setLogs(store.readLogs(500));
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [store]);

  const filtered = useMemo(() => {
    let result = logs;
    if (state.logStepFilter) {
      result = result.filter(l => l.step === state.logStepFilter);
    }
    if (state.logSearch) {
      const search = state.logSearch.toLowerCase();
      result = result.filter(l => l.summary.toLowerCase().includes(search));
    }
    return result;
  }, [logs, state.logStepFilter, state.logSearch]);

  const contentRows = visibleHeight - 2;
  const effectiveScroll =
    state.logScroll === -1
      ? Math.max(0, filtered.length - contentRows)
      : state.logScroll;
  const visible = filtered.slice(
    effectiveScroll,
    effectiveScroll + contentRows
  );
  const fill = ' '.repeat(width);
  const stepLabel = state.logStepFilter ?? 'all';

  return (
    <Box flexDirection="column">
      <Box gap={2}>
        <Box>
          <Text dimColor>{' /'}</Text>
          {state.logSearchActive ? (
            <Text color="yellow">{state.logSearch}_</Text>
          ) : (
            <Text dimColor>{state.logSearch || 'search'}</Text>
          )}
        </Box>
        <Text dimColor>
          step:<Text color="yellow">{stepLabel}</Text>(s)
        </Text>
        <Text dimColor>
          {filtered.length} entr{filtered.length !== 1 ? 'ies' : 'y'}
        </Text>
      </Box>
      {filtered.length === 0 ? (
        <Text backgroundColor={LOG_BG}>
          <Text dimColor>{' No log entries'}</Text>
          <Text>{fill}</Text>
        </Text>
      ) : (
        visible.map((entry, i) => {
          const color = LOG_STEP_COLORS[entry.step] ?? 'gray';
          return (
            <Text key={i} wrap="truncate" backgroundColor={LOG_BG}>
              <Text dimColor>{` ${formatTimestamp(entry.ts)} `}</Text>
              <Text color={color}>{entry.step.padEnd(12)}</Text>
              <Text dimColor>{entry.action.padEnd(12)}</Text>
              <Text>{entry.summary}</Text>
              <Text>{fill}</Text>
            </Text>
          );
        })
      )}
    </Box>
  );
});

// ── Pending Panel ───────────────────────────────────────────────────────────

function PendingDetailView({
  action,
  width,
}: {
  action: PendingAction;
  width: number;
}) {
  const metaStr = action.meta
    ? JSON.stringify(action.meta, null, 2)
    : '(no meta)';
  const metaLines = metaStr.split('\n');
  const sep = '\u2500'.repeat(Math.max(1, width - 4));

  return (
    <Box flexDirection="column">
      {/* Human-readable summary first */}
      <Text bold>{` ${action.action}: ${action.summary}`}</Text>
      <Text dimColor>{` ${timeAgo(action.createdAt)}`}</Text>
      <Text dimColor>{` ${sep}`}</Text>
      <Text>
        <Text dimColor>{' Trace: '}</Text>
        <Text dimColor>{action.traceId}</Text>
      </Text>
      <Text>
        <Text dimColor>{' Action: '}</Text>
        <Text dimColor>{action.actionId}</Text>
      </Text>
      <Text>
        <Text dimColor>{' Span: '}</Text>
        <Text dimColor>{action.spanId}</Text>
      </Text>
      {metaLines.length > 1 || metaStr !== '(no meta)' ? (
        <>
          <Text bold>{' META'}</Text>
          {metaLines.map((line, i) => (
            <Text key={i} dimColor wrap="truncate">
              {'  '}
              {line}
            </Text>
          ))}
        </>
      ) : null}
    </Box>
  );
}

const PendingPanel = React.memo(function PendingPanel({
  store,
  state,
  visibleHeight,
  width,
}: {
  store: AutopilotStore;
  state: InspectorState;
  visibleHeight: number;
  width: number;
}) {
  const [pending, setPending] = React.useState<PendingAction[]>([]);

  useEffect(() => {
    const load = () => setPending(store.getPending());
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [store]);

  if (state.pendingDrillDown && pending[state.pendingSelectedIndex]) {
    return (
      <PendingDetailView
        action={pending[state.pendingSelectedIndex]}
        width={width}
      />
    );
  }

  const startIndex = Math.max(
    0,
    Math.min(
      state.pendingSelectedIndex - Math.floor(visibleHeight / 2),
      Math.max(0, pending.length - visibleHeight + 1)
    )
  );
  const visible = pending.slice(startIndex, startIndex + visibleHeight - 1);

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {` ${pending.length} pending action${pending.length !== 1 ? 's' : ''}`}
      </Text>
      {pending.length === 0 ? (
        <Text dimColor>{' Queue is empty'}</Text>
      ) : (
        visible.map((p, i) => {
          const realIndex = startIndex + i;
          const isSelected = realIndex === state.pendingSelectedIndex;
          const color = LOG_STEP_COLORS[p.action] ?? 'gray';
          return (
            <Text key={`${p.actionId}-${i}`} wrap="truncate">
              <Text color={isSelected ? 'cyan' : undefined}>
                {isSelected ? ' \u25B8 ' : '   '}
              </Text>
              <Text color={color}>{p.action.padEnd(12)}</Text>
              <Text
                color={isSelected ? 'white' : undefined}
                dimColor={!isSelected}
              >
                {p.summary}
              </Text>
              <Text dimColor>{` ${timeAgo(p.createdAt)}`}</Text>
            </Text>
          );
        })
      )}
    </Box>
  );
});

// ── Tasks Panel ─────────────────────────────────────────────────────────────

function TaskDetailView({
  actionId,
  mapping,
  taskInfo,
  actionData,
  scroll,
  visibleHeight,
  width,
}: {
  actionId: string;
  mapping: TaskMapping;
  taskInfo: TaskInfo | undefined;
  actionData: Action | null;
  scroll: number;
  visibleHeight: number;
  width: number;
}) {
  const lines: React.ReactNode[] = [];
  const sep = '\u2500'.repeat(Math.max(1, width - 4));

  const status = taskInfo?.status ?? 'PENDING';
  const statusColor = TASK_STATUS_COLORS[status] ?? 'gray';
  const statusLabel = TASK_STATUS_LABELS[status] ?? status;

  // Human-readable header
  lines.push(
    <Text key="h1" bold>
      {` Task #${mapping.taskId}: ${taskInfo?.title ?? '(unknown)'}`}
    </Text>
  );
  lines.push(
    <Text key="status">
      <Text color={statusColor} bold>
        {` ${statusLabel}`}
      </Text>
      {taskInfo ? (
        <Text dimColor>
          {`  ${taskInfo.agent}  ${taskInfo.duration}  iter ${taskInfo.iteration}`}
        </Text>
      ) : null}
    </Text>
  );

  if (taskInfo) {
    const barWidth = Math.min(30, Math.max(10, width - 20));
    lines.push(
      <Text key="progress">
        <Text dimColor> </Text>
        <Text color={taskInfo.progress >= 100 ? 'green' : 'cyan'}>
          {progressBar(taskInfo.progress, barWidth)}
        </Text>
        <Text>{` ${taskInfo.progress}%`}</Text>
      </Text>
    );
  }

  lines.push(
    <Text key="branch">
      <Text dimColor>{' Branch: '}</Text>
      <Text>{mapping.branchName}</Text>
    </Text>
  );

  lines.push(
    <Text key="sep1" dimColor>
      {` ${sep}`}
    </Text>
  );

  // Action details (human-readable fields first)
  if (actionData) {
    const meta = actionData.meta;
    if (meta.workflow) {
      lines.push(
        <Text key="workflow">
          <Text dimColor>{' Workflow: '}</Text>
          <Text>{meta.workflow}</Text>
        </Text>
      );
    }
    if (meta.description) {
      lines.push(
        <Text key="desc-label" dimColor>
          {' Description:'}
        </Text>
      );
      const descLines = String(meta.description).split('\n');
      for (let di = 0; di < descLines.length; di++) {
        lines.push(
          <Text key={`desc-${di}`} wrap="truncate">
            <Text dimColor>{'   '}</Text>
            <Text>{descLines[di]}</Text>
          </Text>
        );
      }
    }

    if (
      meta.acceptance_criteria &&
      Array.isArray(meta.acceptance_criteria) &&
      meta.acceptance_criteria.length > 0
    ) {
      lines.push(
        <Text key="criteria-title" bold>
          {' ACCEPTANCE CRITERIA'}
        </Text>
      );
      for (let ci = 0; ci < meta.acceptance_criteria.length; ci++) {
        lines.push(
          <Text key={`criteria-${ci}`} wrap="truncate">
            <Text dimColor>{` \u2022 `}</Text>
            <Text>{meta.acceptance_criteria[ci]}</Text>
          </Text>
        );
      }
    }

    if (meta.context) {
      const ctx = meta.context;
      if (ctx.files && Array.isArray(ctx.files) && ctx.files.length > 0) {
        lines.push(
          <Text key="files-title" bold>
            {' CONTEXT FILES'}
          </Text>
        );
        for (let fi = 0; fi < ctx.files.length; fi++) {
          lines.push(
            <Text key={`file-${fi}`} dimColor>
              {'   '}
              {ctx.files[fi]}
            </Text>
          );
        }
      }
      if (ctx.depends_on) {
        lines.push(
          <Text key="depends">
            <Text dimColor>{' Depends on: '}</Text>
            <Text>{ctx.depends_on}</Text>
          </Text>
        );
      }
    }

    if (actionData.reasoning) {
      lines.push(
        <Text key="sep2" dimColor>
          {` ${sep}`}
        </Text>
      );
      lines.push(
        <Text key="reasoning-title" bold>
          {' REASONING'}
        </Text>
      );
      const reasonLines = actionData.reasoning.split('\n');
      for (let ri = 0; ri < reasonLines.length; ri++) {
        lines.push(
          <Text key={`reason-${ri}`} wrap="truncate">
            {'  '}
            {reasonLines[ri]}
          </Text>
        );
      }
    }

    // IDs at the bottom (technical details)
    lines.push(
      <Text key="sep3" dimColor>
        {` ${sep}`}
      </Text>
    );
    lines.push(
      <Text key="ids" dimColor>
        {` task:${mapping.taskId}  action:${actionId.slice(0, 8)}..`}
        {actionData.spanId ? `  span:${actionData.spanId.slice(0, 8)}..` : ''}
      </Text>
    );
  }

  const sliced = lines.slice(scroll, scroll + visibleHeight);
  return (
    <Box flexDirection="column" height={visibleHeight}>
      {sliced.map((line, i) => (
        <Box key={`row-${i}`}>{line}</Box>
      ))}
    </Box>
  );
}

const TasksPanel = React.memo(function TasksPanel({
  store,
  tasks,
  state,
  visibleHeight,
  width,
}: {
  store: AutopilotStore;
  tasks: TaskInfo[];
  state: InspectorState;
  visibleHeight: number;
  width: number;
}) {
  const [mappings, setMappings] = React.useState<Record<string, TaskMapping>>(
    {}
  );
  const actionCache = useRef<Map<string, Action | null>>(new Map());

  useEffect(() => {
    const load = () => setMappings(store.getAllTaskMappings());
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [store]);

  const entries = Object.entries(mappings);

  if (state.taskDrillDown && state.taskSelectedActionId) {
    const selectedActionId = state.taskSelectedActionId;
    const mapping = mappings[selectedActionId];
    if (mapping) {
      if (!actionCache.current.has(selectedActionId)) {
        actionCache.current.set(
          selectedActionId,
          store.readAction(selectedActionId)
        );
      }
      const actionData = actionCache.current.get(selectedActionId) ?? null;
      const taskInfo = tasks.find(t => t.id === mapping.taskId);

      return (
        <TaskDetailView
          actionId={selectedActionId}
          mapping={mapping}
          taskInfo={taskInfo}
          actionData={actionData}
          scroll={state.taskDetailScroll}
          visibleHeight={visibleHeight}
          width={width}
        />
      );
    }
  }

  const startIndex = Math.max(
    0,
    Math.min(
      state.taskSelectedIndex - Math.floor(visibleHeight / 2),
      Math.max(0, entries.length - visibleHeight + 1)
    )
  );
  const visible = entries.slice(startIndex, startIndex + visibleHeight - 1);

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {` ${entries.length} task mapping${entries.length !== 1 ? 's' : ''}`}
      </Text>
      {entries.length === 0 ? (
        <Text dimColor>{' No task mappings'}</Text>
      ) : (
        visible.map(([aid, mapping], i) => {
          const realIndex = startIndex + i;
          const isSelected = realIndex === state.taskSelectedIndex;

          const taskInfo = tasks.find(t => t.id === mapping.taskId);
          const status = taskInfo?.status ?? 'PENDING';
          const statusColor = TASK_STATUS_COLORS[status] ?? 'gray';
          const statusLabel = TASK_STATUS_LABELS[status] ?? status;
          const duration = taskInfo?.duration ?? '--';
          const title = taskInfo?.title ?? '';

          return (
            <Box key={aid}>
              <Text color={isSelected ? 'cyan' : undefined}>
                {isSelected ? ' \u25B8 ' : '   '}
              </Text>
              <Text>{`#${String(mapping.taskId).padEnd(3)}`}</Text>
              <Text color={statusColor} bold>
                {` ${statusLabel.padEnd(9)}`}
              </Text>
              <Text dimColor>{` ${mapping.branchName.padEnd(20)}`}</Text>
              <Box flexGrow={1}>
                <Text
                  dimColor={!isSelected}
                  color={isSelected ? 'white' : undefined}
                  wrap="truncate"
                >
                  {` ${title}`}
                </Text>
              </Box>
              <Text dimColor>{` ${duration.padStart(6)}`}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
});

// ── Main Inspector View ─────────────────────────────────────────────────────

export function InspectorView({
  traces,
  tracesRef: _tracesRef,
  store,
  tasks,
  width,
  height,
  onClose,
}: {
  traces: ActionTrace[];
  tracesRef: React.MutableRefObject<Map<string, ActionTrace>>;
  store: AutopilotStore;
  tasks: TaskInfo[];
  width: number;
  height: number;
  onClose: () => void;
}) {
  const [state, dispatch] = useReducer(
    inspectorReducer,
    undefined,
    initialState
  );

  const getMaxIndex = useCallback((): number => {
    if (state.activeTab === 'traces') {
      if (state.traceDrillDown) {
        if (state.traceStepDrillDown) {
          return 999;
        }
        const selectedTrace = traces.find(
          c => c.traceId === state.traceSelectedId
        );
        return Math.max(0, selectedTrace?.steps.length ?? 0);
      }
      const filtered = filterTraces(traces, state.traceFilter);
      return Math.max(0, filtered.length - 1);
    }
    return 999;
  }, [
    state.activeTab,
    state.traceFilter,
    state.traceDrillDown,
    state.traceStepDrillDown,
    state.traceSelectedId,
    traces,
  ]);

  useInput((input, key) => {
    if (input === 'i' && !key.ctrl && !key.meta && !state.logSearchActive) {
      onClose();
      return;
    }

    if (state.logSearchActive && state.activeTab === 'logs') {
      if (key.escape) {
        dispatch({ type: 'ESCAPE' });
        return;
      }
      if (key.backspace || key.delete) {
        dispatch({ type: 'LOG_SEARCH_BACKSPACE' });
        return;
      }
      if (key.return) {
        dispatch({ type: 'TOGGLE_LOG_SEARCH' });
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        dispatch({ type: 'LOG_SEARCH_CHAR', char: input });
        return;
      }
      return;
    }

    if (key.tab && !key.shift) {
      dispatch({ type: 'NEXT_TAB' });
      return;
    }
    if (key.tab && key.shift) {
      dispatch({ type: 'PREV_TAB' });
      return;
    }

    if (key.upArrow) {
      dispatch({ type: 'MOVE_UP' });
      return;
    }
    if (key.downArrow) {
      dispatch({ type: 'MOVE_DOWN', maxIndex: getMaxIndex() });
      return;
    }

    if (key.return) {
      if (state.activeTab === 'traces' && !state.traceDrillDown) {
        const filtered = filterTraces(traces, state.traceFilter);
        const sorted = [...filtered].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        const selected = sorted[state.traceSelectedIndex];
        if (selected) {
          dispatch({ type: 'ENTER', traceId: selected.traceId });
        }
      } else if (state.activeTab === 'tasks' && !state.taskDrillDown) {
        const mappingEntries = Object.entries(store.getAllTaskMappings());
        const selected = mappingEntries[state.taskSelectedIndex];
        if (selected) {
          dispatch({ type: 'ENTER', taskActionId: selected[0] });
        }
      } else {
        dispatch({ type: 'ENTER' });
      }
      return;
    }
    if (key.escape) {
      if (
        (state.activeTab === 'traces' && state.traceDrillDown) ||
        (state.activeTab === 'pending' && state.pendingDrillDown) ||
        (state.activeTab === 'tasks' && state.taskDrillDown) ||
        (state.activeTab === 'logs' && state.logSearchActive)
      ) {
        dispatch({ type: 'ESCAPE' });
      } else {
        onClose();
      }
      return;
    }

    if (input === '/' && state.activeTab === 'logs') {
      dispatch({ type: 'TOGGLE_LOG_SEARCH' });
      return;
    }
    if (
      input === 'f' &&
      state.activeTab === 'traces' &&
      !state.traceDrillDown
    ) {
      dispatch({ type: 'CYCLE_TRACE_FILTER' });
      return;
    }
    if (input === 's' && state.activeTab === 'logs') {
      dispatch({ type: 'CYCLE_LOG_STEP_FILTER' });
      return;
    }
  });

  // No borders: header(1) + separator(1) + footer(1) = 3 reserved lines
  const panelHeight = Math.max(1, height - 3);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <InspectorTabs activeTab={state.activeTab} />
      <SectionHeader title="" width={width} />

      <Box flexDirection="column" flexGrow={1}>
        {state.activeTab === 'traces' && (
          <TracesPanel
            traces={traces}
            store={store}
            state={state}
            visibleHeight={panelHeight}
            width={width}
          />
        )}
        {state.activeTab === 'logs' && (
          <LogsPanel
            store={store}
            state={state}
            visibleHeight={panelHeight}
            width={width}
          />
        )}
        {state.activeTab === 'pending' && (
          <PendingPanel
            store={store}
            state={state}
            visibleHeight={panelHeight}
            width={width}
          />
        )}
        {state.activeTab === 'tasks' && (
          <TasksPanel
            store={store}
            tasks={tasks}
            state={state}
            visibleHeight={panelHeight}
            width={width}
          />
        )}
      </Box>

      <InspectorFooter activeTab={state.activeTab} state={state} />
    </Box>
  );
}
