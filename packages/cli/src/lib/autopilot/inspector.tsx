import React, { useReducer, useEffect, useRef, useCallback } from 'react';
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
    logScroll: -1, // -1 means auto-scroll to bottom
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

// ── Colors ──────────────────────────────────────────────────────────────────

const STEP_COLORS: Record<ActionStepStatus, string> = {
  completed: 'green',
  running: 'cyan',
  pending: 'gray',
  failed: 'red',
  error: 'yellow',
};

const STEP_FILLED: Record<ActionStepStatus, string> = {
  completed: '\u25A0',
  running: '\u25A0',
  pending: '\u25A1',
  failed: '\u25A0',
  error: '\u25A0',
};

const STEP_TERMINAL: Record<ActionStepStatus, string> = {
  completed: '\u25CF',
  running: '\u25CF',
  pending: '\u25CB',
  failed: '\u25CF',
  error: '\u25CF',
};

const LOG_STEP_COLORS: Record<string, string> = {
  event: 'yellow',
  coordinate: 'cyan',
  plan: 'magenta',
  workflow: 'blue',
  commit: 'green',
  resolve: 'yellow',
};

const TASK_STATUS_COLORS: Record<string, string> = {
  IN_PROGRESS: 'cyan',
  ITERATING: 'cyan',
  COMPLETED: 'green',
  MERGED: 'green',
  PUSHED: 'green',
  FAILED: 'red',
  PENDING: 'gray',
  NEW: 'gray',
};

// ── Utility ─────────────────────────────────────────────────────────────────

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

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

function InspectorHeader() {
  return (
    <Box>
      <Text bold color="cyan">
        INSPECTOR
      </Text>
    </Box>
  );
}

function InspectorTabs({ activeTab }: { activeTab: InspectorTab }) {
  return (
    <Box gap={1}>
      {TABS.map(tab => (
        <Text
          key={tab}
          bold={tab === activeTab}
          color={tab === activeTab ? 'cyan' : 'gray'}
        >
          {tab === activeTab ? `[${tab.toUpperCase()}]` : ` ${tab} `}
        </Text>
      ))}
    </Box>
  );
}

function InspectorFooter({
  activeTab,
  state,
}: {
  activeTab: InspectorTab;
  state: InspectorState;
}) {
  const parts: string[] = ['Tab:switch', 'Up/Dn:navigate'];

  if (activeTab === 'traces') {
    if (state.traceDrillDown && state.traceStepDrillDown) {
      parts.push('Esc:back');
    } else if (state.traceDrillDown) {
      parts.push('Enter:step detail', 'Esc:back');
    } else {
      parts.push('Enter:detail', 'f:filter');
    }
  }

  if (activeTab === 'logs') {
    parts.push('/:search', 's:step filter');
  }

  if (activeTab === 'pending') {
    if (state.pendingDrillDown) {
      parts.push('Esc:back');
    } else {
      parts.push('Enter:detail');
    }
  }

  if (activeTab === 'tasks') {
    if (state.taskDrillDown) {
      parts.push('Esc:back');
    } else {
      parts.push('Enter:detail');
    }
  }

  parts.push('Esc:back', 'i:close');

  return (
    <Box>
      <Text dimColor>{parts.join('  ')}</Text>
    </Box>
  );
}

// ── Traces Panel ────────────────────────────────────────────────────────────

function TracesListView({
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
  const filtered = filterTraces(traces, filter);
  const sorted = [...filtered].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Center selected item in viewport
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
      <Text>
        <Text dimColor> Filter: </Text>
        <Text color="yellow">{filter}</Text>
        <Text dimColor> (f to cycle)</Text>
      </Text>
      <Text> </Text>
      {sorted.length === 0 ? (
        <Text dimColor> No traces match filter</Text>
      ) : (
        visible.map((trace, i) => {
          const realIndex = startIndex + i;
          const isSelected = realIndex === selectedIndex;
          return (
            <Box key={trace.traceId}>
              <Text color={isSelected ? 'cyan' : undefined}>
                {isSelected ? ' > ' : '   '}
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
              <Text> </Text>
              <Text
                color={isSelected ? 'white' : undefined}
                dimColor={!isSelected}
                wrap="truncate"
              >
                {trace.summary}
              </Text>
            </Box>
          );
        })
      )}
    </Box>
  );
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
  const sep = '\u2500'.repeat(Math.max(1, width - 6));

  // Header
  lines.push(
    <Text key="h1" bold>
      <Text> Step #{displayIndex + 1}: </Text>
      <Text color={STEP_COLORS[stepStatus]}>{stepLabel}</Text>
      <Text dimColor> ({stepStatus})</Text>
    </Text>
  );
  lines.push(
    <Text key="sep1" dimColor>
      {' '}
      {sep}
    </Text>
  );

  // Span section
  if (span) {
    lines.push(
      <Text key="span-title" bold>
        {' '}
        SPAN
      </Text>
    );
    lines.push(
      <Text key="span-id">
        <Text dimColor> ID: </Text>
        <Text>{span.id}</Text>
      </Text>
    );
    lines.push(
      <Text key="span-step">
        <Text dimColor> Step: </Text>
        <Text>{span.step}</Text>
      </Text>
    );
    if (span.status) {
      const spanStatusColor =
        span.status === 'completed'
          ? 'green'
          : span.status === 'failed'
            ? 'red'
            : span.status === 'error'
              ? 'yellow'
              : 'cyan';
      lines.push(
        <Text key="span-status">
          <Text dimColor> Status: </Text>
          <Text color={spanStatusColor}>{span.status}</Text>
        </Text>
      );
    }
    lines.push(
      <Text key="span-ts">
        <Text dimColor> Timestamp: </Text>
        <Text>{span.timestamp}</Text>
      </Text>
    );
    if (span.completed) {
      lines.push(
        <Text key="span-completed">
          <Text dimColor> Completed: </Text>
          <Text>{span.completed}</Text>
        </Text>
      );
    }
    lines.push(
      <Text key="span-summary">
        <Text dimColor> Summary: </Text>
        <Text>{span.summary}</Text>
      </Text>
    );
    lines.push(
      <Text key="span-parent">
        <Text dimColor> Parent: </Text>
        <Text>{span.parent ?? '(none)'}</Text>
      </Text>
    );

    if (span.meta && Object.keys(span.meta).length > 0) {
      lines.push(<Text key="span-meta-sep"> </Text>);
      lines.push(
        <Text key="span-meta-title" bold>
          {' '}
          SPAN META
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
    lines.push(<Text key="no-span-sep"> </Text>);
    lines.push(
      <Text key="no-span-title" bold>
        {' '}
        SPAN
      </Text>
    );
    const waitingArt = [
      '',
      '          _~^~^~_',
      '      \\) /  o o  \\ (/',
      "        '_   -   _'",
      "        / '-----' \\",
      '',
      '    Waiting for span data...',
      '    This step has not produced',
      '    its span yet.',
      '',
    ];
    for (let wi = 0; wi < waitingArt.length; wi++) {
      lines.push(
        <Text key={`wait-span-${wi}`} dimColor>
          {'  '}
          {waitingArt[wi]}
        </Text>
      );
    }
  }

  // Action section
  lines.push(
    <Text key="sep2" dimColor>
      {' '}
      {sep}
    </Text>
  );
  if (actionData) {
    lines.push(
      <Text key="action-title" bold>
        {' '}
        OUTPUT ACTION
      </Text>
    );
    lines.push(
      <Text key="action-id">
        <Text dimColor> ID: </Text>
        <Text>{actionData.id}</Text>
      </Text>
    );
    lines.push(
      <Text key="action-action">
        <Text dimColor> Action: </Text>
        <Text>{actionData.action}</Text>
      </Text>
    );
    lines.push(
      <Text key="action-ts">
        <Text dimColor> Timestamp: </Text>
        <Text>{actionData.timestamp}</Text>
      </Text>
    );
    lines.push(
      <Text key="action-reasoning" wrap="truncate">
        <Text dimColor> Reasoning: </Text>
        <Text>{actionData.reasoning}</Text>
      </Text>
    );

    if (actionData.meta && Object.keys(actionData.meta).length > 0) {
      lines.push(<Text key="action-meta-sep"> </Text>);
      lines.push(
        <Text key="action-meta-title" bold>
          {' '}
          ACTION META
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
    lines.push(<Text key="no-action-sep"> </Text>);
    lines.push(
      <Text key="no-action-title" bold>
        {' '}
        OUTPUT ACTION
      </Text>
    );
    const waitingArt = [
      '',
      '        .     *   .   *',
      '     *    .  \\|/  .    *',
      '       .  --=*=--  .',
      '     *    .  /|\\  .    *',
      '        .     *   .   *',
      '',
      '    Waiting for output action...',
      '    This step has not decided',
      '    what to do next.',
      '',
    ];
    for (let wi = 0; wi < waitingArt.length; wi++) {
      lines.push(
        <Text key={`wait-action-${wi}`} dimColor>
          {'  '}
          {waitingArt[wi]}
        </Text>
      );
    }
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

// Build the display list for trace steps.
// Display index 0 = "event" (the trigger), indices 1..N = trace.steps[0..N-1].
// Total display count = trace.steps.length + 1.
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

// Resolve the span and output action for a display step.
//
// Each trace step's actionId identifies the action being executed at that step.
// That action's spanId points to the span that CREATED it (the previous step's
// span). So to get a step's OWN span and the action it PRODUCED, we look at
// the NEXT trace step's action:
//   trace.steps[di].actionId  →  action.spanId = step di's own span
//                             →  the action itself = what step di produced
//
// Display index mapping:
//   di=0 (event)     → trace.steps[0].actionId gives event span + event output
//   di=1..N-1        → trace.steps[di].actionId gives step di's span + output
//   di=N (last step) → no trace.steps[N], data not yet available
//
// Special case: span-only steps (e.g. noop) have a spanId on the step itself
// and no follow-up action. These are always the last step in the trace.
function loadStepData(
  di: number,
  trace: ActionTrace,
  store: AutopilotStore,
  cache: Map<string, Action | null>
): { span: Span | null; actionData: Action | null } {
  if (di > 0) {
    const traceStep = trace.steps[di - 1];

    // Terminal step with spanId: read span directly, no output action
    if (traceStep?.terminal && traceStep.spanId) {
      const span = store.readSpan(traceStep.spanId);
      return { span, actionData: null };
    }

    // Non-terminal step with spanId: read span directly, also read output
    // action from the next trace step if available
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

    // No spanId on the trace step: fall through to next-step-action logic
  }

  // di == 0 (event) or fallback: use next trace step's action to find span
  if (di < trace.steps.length) {
    const actionId = trace.steps[di].actionId;
    if (!cache.has(actionId)) {
      cache.set(actionId, store.readAction(actionId));
    }
    const actionData = cache.get(actionId) ?? null;
    const span = actionData?.spanId ? store.readSpan(actionData.spanId) : null;
    return { span, actionData };
  }
  // Last display step: no next trace step to reference
  return { span: null, actionData: null };
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

  // Step drill-down mode
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

  // Step selection mode
  const lines: React.ReactNode[] = [];

  // Header
  lines.push(
    <Text key="h1" bold>
      {' '}
      Trace: {trace.summary}
    </Text>
  );
  lines.push(
    <Text key="h2" dimColor>
      {' '}
      Created: {trace.createdAt}
    </Text>
  );
  lines.push(
    <Text key="sep1" dimColor>
      {' '}
      {'\u2500'.repeat(Math.max(1, width - 6))}
    </Text>
  );

  // Steps (selectable) — includes event + trace steps
  lines.push(
    <Text key="steps-title" bold>
      {' '}
      STEPS
    </Text>
  );
  displaySteps.forEach((ds, i) => {
    const isSelected = i === selectedStepIndex;
    const color = STEP_COLORS[ds.status];
    lines.push(
      <Text key={`step-${i}`} wrap="truncate">
        <Text color={isSelected ? 'cyan' : undefined}>
          {isSelected ? ' > ' : '   '}
        </Text>
        <Text>{`${i + 1}. `}</Text>
        <Text color={color}>
          {ds.terminal ? STEP_TERMINAL[ds.status] : STEP_FILLED[ds.status]}
        </Text>
        <Text color={color}> {ds.label.padEnd(12)}</Text>
        <Text dimColor={!isSelected}>
          {ds.status.padEnd(10)} {ds.reasoning ?? 'pending'}
        </Text>
      </Text>
    );
  });

  // Viewport scrolling: center selected step
  const headerLines = 4; // h1, h2, sep1, steps-title
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

function TracesPanel({
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
  // In drill-down mode, find trace by ID (stable across reorders)
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
      visibleHeight={visibleHeight - 2}
    />
  );
}

// ── Logs Panel ──────────────────────────────────────────────────────────────

function LogsPanel({
  store,
  state,
  visibleHeight,
}: {
  store: AutopilotStore;
  state: InspectorState;
  visibleHeight: number;
}) {
  const [logs, setLogs] = React.useState<AutopilotLogEntry[]>([]);

  useEffect(() => {
    const load = () => setLogs(store.readLogs(500));
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [store]);

  // Apply filters
  let filtered = logs;
  if (state.logStepFilter) {
    filtered = filtered.filter(l => l.step === state.logStepFilter);
  }
  if (state.logSearch) {
    const search = state.logSearch.toLowerCase();
    filtered = filtered.filter(l => l.summary.toLowerCase().includes(search));
  }

  // Scrolling
  const effectiveScroll =
    state.logScroll === -1
      ? Math.max(0, filtered.length - visibleHeight + 2)
      : state.logScroll;
  const visible = filtered.slice(
    effectiveScroll,
    effectiveScroll + visibleHeight - 2
  );

  const stepLabel = state.logStepFilter ?? 'all';

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor> Search: </Text>
        {state.logSearchActive ? (
          <Text color="yellow">{state.logSearch}_</Text>
        ) : (
          <Text dimColor>{state.logSearch || '(/ to toggle)'}</Text>
        )}
        <Text dimColor> Step: </Text>
        <Text color="yellow">{stepLabel}</Text>
        <Text dimColor> (s to cycle)</Text>
      </Box>
      <Text dimColor> {'\u2500'.repeat(50)}</Text>
      {filtered.length === 0 ? (
        <Text dimColor> No log entries</Text>
      ) : (
        visible.map((entry, i) => {
          const color = LOG_STEP_COLORS[entry.step] ?? 'gray';
          return (
            <Text key={i} wrap="truncate">
              <Text dimColor> {formatTimestamp(entry.ts)} </Text>
              <Text color={color}>{entry.step.padEnd(12)}</Text>
              <Text dimColor>{entry.action.padEnd(12)}</Text>
              <Text>{entry.summary}</Text>
            </Text>
          );
        })
      )}
    </Box>
  );
}

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

  return (
    <Box flexDirection="column">
      <Text bold> Pending Action</Text>
      <Text dimColor> {'\u2500'.repeat(Math.max(1, width - 6))}</Text>
      <Text>
        <Text dimColor> Trace: </Text>
        <Text>{action.traceId}</Text>
      </Text>
      <Text>
        <Text dimColor> Action ID: </Text>
        <Text>{action.actionId}</Text>
      </Text>
      <Text>
        <Text dimColor> Span ID: </Text>
        <Text>{action.spanId}</Text>
      </Text>
      <Text>
        <Text dimColor> Action: </Text>
        <Text>{action.action}</Text>
      </Text>
      <Text>
        <Text dimColor> Summary: </Text>
        <Text>{action.summary}</Text>
      </Text>
      <Text>
        <Text dimColor> Created: </Text>
        <Text>{action.createdAt}</Text>
      </Text>
      <Text> </Text>
      <Text bold> META</Text>
      {metaLines.map((line, i) => (
        <Text key={i} dimColor wrap="truncate">
          {' '}
          {line}
        </Text>
      ))}
    </Box>
  );
}

function PendingPanel({
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

  // Center selected item in viewport
  const startIndex = Math.max(
    0,
    Math.min(
      state.pendingSelectedIndex - Math.floor(visibleHeight / 2),
      Math.max(0, pending.length - visibleHeight + 2)
    )
  );
  const visible = pending.slice(startIndex, startIndex + visibleHeight - 2);

  return (
    <Box flexDirection="column">
      <Text bold> Pending Actions ({pending.length})</Text>
      <Text dimColor> {'\u2500'.repeat(Math.max(1, width - 6))}</Text>
      {pending.length === 0 ? (
        <Text dimColor> No pending actions</Text>
      ) : (
        visible.map((p, i) => {
          const realIndex = startIndex + i;
          const isSelected = realIndex === state.pendingSelectedIndex;
          const color = LOG_STEP_COLORS[p.action] ?? 'gray';
          return (
            <Text key={`${p.actionId}-${i}`} wrap="truncate">
              <Text color={isSelected ? 'cyan' : undefined}>
                {isSelected ? ' > ' : '   '}
              </Text>
              <Text color={color}>[{p.action}]</Text>
              <Text> </Text>
              <Text
                color={isSelected ? 'white' : undefined}
                dimColor={!isSelected}
              >
                {p.summary}
              </Text>
              <Text dimColor> {timeAgo(p.createdAt)}</Text>
            </Text>
          );
        })
      )}
    </Box>
  );
}

// ── Tasks Panel ─────────────────────────────────────────────────────────────

function progressBar(progress: number, barWidth: number): string {
  const filled = Math.round((progress / 100) * barWidth);
  const empty = barWidth - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

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
  const sep = '\u2500'.repeat(Math.max(1, width - 6));

  const status = taskInfo?.status ?? 'PENDING';
  const statusColor = TASK_STATUS_COLORS[status] ?? 'gray';

  // Header
  lines.push(
    <Text key="h1" bold>
      {' '}
      Task #{mapping.taskId}: {taskInfo?.title ?? '(unknown)'}
    </Text>
  );
  lines.push(
    <Text key="sep1" dimColor>
      {' '}
      {sep}
    </Text>
  );

  // Status section
  lines.push(
    <Text key="status">
      <Text dimColor> Status: </Text>
      <Text color={statusColor} bold>
        {status}
      </Text>
    </Text>
  );

  if (taskInfo) {
    const barWidth = Math.min(30, Math.max(10, width - 25));
    lines.push(
      <Text key="progress">
        <Text dimColor> Progress: </Text>
        <Text color={taskInfo.progress >= 100 ? 'green' : 'cyan'}>
          [{progressBar(taskInfo.progress, barWidth)}]
        </Text>
        <Text> {taskInfo.progress}%</Text>
      </Text>
    );

    lines.push(
      <Text key="agent">
        <Text dimColor> Agent: </Text>
        <Text>{taskInfo.agent}</Text>
      </Text>
    );
    lines.push(
      <Text key="duration">
        <Text dimColor> Duration: </Text>
        <Text>{taskInfo.duration}</Text>
      </Text>
    );
    lines.push(
      <Text key="iteration">
        <Text dimColor> Iterations: </Text>
        <Text>{taskInfo.iteration}</Text>
      </Text>
    );
  }

  lines.push(
    <Text key="branch">
      <Text dimColor> Branch: </Text>
      <Text>{mapping.branchName}</Text>
    </Text>
  );

  // IDs section
  lines.push(<Text key="sep2"> </Text>);
  lines.push(
    <Text key="ids-title" bold>
      {' '}
      IDENTIFIERS
    </Text>
  );
  lines.push(
    <Text key="task-id">
      <Text dimColor> Task ID: </Text>
      <Text>{mapping.taskId}</Text>
    </Text>
  );
  lines.push(
    <Text key="action-id">
      <Text dimColor> Action ID: </Text>
      <Text>{actionId}</Text>
    </Text>
  );
  if (actionData?.spanId) {
    lines.push(
      <Text key="span-id">
        <Text dimColor> Span ID: </Text>
        <Text>{actionData.spanId}</Text>
      </Text>
    );
  }

  // Action details
  if (actionData) {
    lines.push(<Text key="sep3"> </Text>);
    lines.push(
      <Text key="action-title" bold>
        {' '}
        ACTION DETAILS
      </Text>
    );

    const meta = actionData.meta;
    if (meta.workflow) {
      lines.push(
        <Text key="workflow">
          <Text dimColor> Workflow: </Text>
          <Text>{meta.workflow}</Text>
        </Text>
      );
    }
    if (meta.title) {
      lines.push(
        <Text key="meta-title">
          <Text dimColor> Title: </Text>
          <Text>{meta.title}</Text>
        </Text>
      );
    }
    if (meta.description) {
      lines.push(
        <Text key="desc-label" dimColor>
          {' '}
          Description:
        </Text>
      );
      const descLines = String(meta.description).split('\n');
      for (let di = 0; di < descLines.length; di++) {
        lines.push(
          <Text key={`desc-${di}`} wrap="truncate">
            <Text dimColor> {'  '}</Text>
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
      lines.push(<Text key="sep4"> </Text>);
      lines.push(
        <Text key="criteria-title" bold>
          {' '}
          ACCEPTANCE CRITERIA
        </Text>
      );
      for (let ci = 0; ci < meta.acceptance_criteria.length; ci++) {
        lines.push(
          <Text key={`criteria-${ci}`} wrap="truncate">
            <Text dimColor> {'\u2022'} </Text>
            <Text>{meta.acceptance_criteria[ci]}</Text>
          </Text>
        );
      }
    }

    if (meta.context) {
      const ctx = meta.context;
      if (ctx.files && Array.isArray(ctx.files) && ctx.files.length > 0) {
        lines.push(<Text key="sep5"> </Text>);
        lines.push(
          <Text key="files-title" bold>
            {' '}
            CONTEXT FILES
          </Text>
        );
        for (let fi = 0; fi < ctx.files.length; fi++) {
          lines.push(
            <Text key={`file-${fi}`} dimColor>
              {' '}
              {ctx.files[fi]}
            </Text>
          );
        }
      }
      if (ctx.depends_on) {
        lines.push(
          <Text key="depends">
            <Text dimColor> Depends on: </Text>
            <Text>{ctx.depends_on}</Text>
          </Text>
        );
      }
    }

    if (actionData.reasoning) {
      lines.push(<Text key="sep6"> </Text>);
      lines.push(
        <Text key="reasoning-title" bold>
          {' '}
          REASONING
        </Text>
      );
      const reasonLines = actionData.reasoning.split('\n');
      for (let ri = 0; ri < reasonLines.length; ri++) {
        lines.push(
          <Text key={`reason-${ri}`} wrap="truncate">
            <Text dimColor> </Text>
            <Text>{reasonLines[ri]}</Text>
          </Text>
        );
      }
    }
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

function TasksPanel({
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

  // Drill-down: find selected entry by actionId (stable across reorders)
  if (state.taskDrillDown && state.taskSelectedActionId) {
    const selectedActionId = state.taskSelectedActionId;
    const mapping = mappings[selectedActionId];
    if (mapping) {
      // Load action data if not cached
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

  // Center selected item in viewport
  const startIndex = Math.max(
    0,
    Math.min(
      state.taskSelectedIndex - Math.floor(visibleHeight / 2),
      Math.max(0, entries.length - visibleHeight + 2)
    )
  );
  const visible = entries.slice(startIndex, startIndex + visibleHeight - 2);

  return (
    <Box flexDirection="column">
      <Text bold> Task Mappings ({entries.length})</Text>
      <Text dimColor> {'\u2500'.repeat(Math.max(1, width - 6))}</Text>
      {entries.length === 0 ? (
        <Text dimColor> No task mappings</Text>
      ) : (
        visible.map(([actionId, mapping], i) => {
          const realIndex = startIndex + i;
          const isSelected = realIndex === state.taskSelectedIndex;

          // Find matching task info
          const taskInfo = tasks.find(t => t.id === mapping.taskId);
          const status = taskInfo?.status ?? 'PENDING';
          const statusColor = TASK_STATUS_COLORS[status] ?? 'gray';
          const duration = taskInfo?.duration ?? '--';

          return (
            <Text key={actionId} wrap="truncate">
              <Text color={isSelected ? 'cyan' : undefined}>
                {isSelected ? ' > ' : '   '}
              </Text>
              <Text dimColor>{actionId.slice(0, 6)}..</Text>
              <Text dimColor> {'\u2192'} </Text>
              <Text>#{mapping.taskId}</Text>
              <Text dimColor> {mapping.branchName.padEnd(20)}</Text>
              <Text color={statusColor}> {status.padEnd(12)}</Text>
              <Text dimColor> {duration}</Text>
            </Text>
          );
        })
      )}
    </Box>
  );
}

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

  // Compute max indices for current tab's list
  const getMaxIndex = useCallback((): number => {
    if (state.activeTab === 'traces') {
      if (state.traceDrillDown) {
        if (state.traceStepDrillDown) {
          return 999; // step detail uses scroll
        }
        // Step selection: display list = event + trace.steps
        const selectedTrace = traces.find(
          c => c.traceId === state.traceSelectedId
        );
        return Math.max(0, selectedTrace?.steps.length ?? 0);
      }
      const filtered = filterTraces(traces, state.traceFilter);
      return Math.max(0, filtered.length - 1);
    }
    return 999; // logs use scroll, not index
  }, [
    state.activeTab,
    state.traceFilter,
    state.traceDrillDown,
    state.traceStepDrillDown,
    state.traceSelectedId,
    traces,
  ]);

  useInput((input, key) => {
    // Close inspector with 'i' (only when not in search mode)
    if (input === 'i' && !key.ctrl && !key.meta && !state.logSearchActive) {
      onClose();
      return;
    }

    // Search mode input handling
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
      // Regular character input
      if (input && !key.ctrl && !key.meta) {
        dispatch({ type: 'LOG_SEARCH_CHAR', char: input });
        return;
      }
      return;
    }

    // Tab navigation
    if (key.tab && !key.shift) {
      dispatch({ type: 'NEXT_TAB' });
      return;
    }
    if (key.tab && key.shift) {
      dispatch({ type: 'PREV_TAB' });
      return;
    }

    // Arrow navigation
    if (key.upArrow) {
      dispatch({ type: 'MOVE_UP' });
      return;
    }
    if (key.downArrow) {
      dispatch({ type: 'MOVE_DOWN', maxIndex: getMaxIndex() });
      return;
    }

    // Enter / Escape
    if (key.return) {
      if (state.activeTab === 'traces' && !state.traceDrillDown) {
        // Resolve the traceId from the current sorted/filtered list
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
        // Resolve the actionId from the current task mappings
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
      // If in drill-down or search, go back
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

    // Tab-specific keys
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

  // Panel area: total height minus header(1) + tabs(1) + separator(1) + footer(1) + border(2) + padding
  const panelHeight = Math.max(1, height - 8);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      width={width}
      height={height}
    >
      <InspectorHeader />
      <InspectorTabs activeTab={state.activeTab} />
      <Text dimColor>{'\u2500'.repeat(Math.max(1, width - 4))}</Text>

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
          <LogsPanel store={store} state={state} visibleHeight={panelHeight} />
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
