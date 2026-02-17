import React, { useReducer, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import type {
  ActionChain,
  ActionStepStatus,
  AutopilotLogEntry,
  PendingAction,
  TaskInfo,
  TaskMapping,
  Trace,
} from './types.js';
import type { AutopilotStore } from './store.js';

// ── Types ───────────────────────────────────────────────────────────────────

type InspectorTab = 'chains' | 'logs' | 'pending' | 'tasks';
type ChainFilter = 'all' | 'active' | 'completed' | 'failed';
type LogStepFilter = string | null;

interface InspectorState {
  activeTab: InspectorTab;
  // Chains
  chainSelectedIndex: number;
  chainDrillDown: boolean;
  chainDetailScroll: number;
  chainFilter: ChainFilter;
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
}

type InspectorAction =
  | { type: 'SET_TAB'; tab: InspectorTab }
  | { type: 'NEXT_TAB' }
  | { type: 'PREV_TAB' }
  | { type: 'MOVE_UP' }
  | { type: 'MOVE_DOWN'; maxIndex: number }
  | { type: 'ENTER' }
  | { type: 'ESCAPE' }
  | { type: 'CYCLE_CHAIN_FILTER' }
  | { type: 'TOGGLE_LOG_SEARCH' }
  | { type: 'LOG_SEARCH_CHAR'; char: string }
  | { type: 'LOG_SEARCH_BACKSPACE' }
  | { type: 'CYCLE_LOG_STEP_FILTER' }
  | { type: 'SCROLL_UP' }
  | { type: 'SCROLL_DOWN'; maxScroll: number };

const TABS: InspectorTab[] = ['chains', 'logs', 'pending', 'tasks'];
const CHAIN_FILTERS: ChainFilter[] = ['all', 'active', 'completed', 'failed'];
const LOG_STEP_FILTERS: (string | null)[] = [
  null,
  'event',
  'coordinate',
  'plan',
  'workflow',
  'review',
];

function initialState(): InspectorState {
  return {
    activeTab: 'chains',
    chainSelectedIndex: 0,
    chainDrillDown: false,
    chainDetailScroll: 0,
    chainFilter: 'all',
    logScroll: -1, // -1 means auto-scroll to bottom
    logSearch: '',
    logSearchActive: false,
    logStepFilter: null,
    pendingSelectedIndex: 0,
    pendingDrillDown: false,
    taskSelectedIndex: 0,
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
      if (state.activeTab === 'chains') {
        if (state.chainDrillDown)
          return {
            ...state,
            chainDetailScroll: Math.max(0, state.chainDetailScroll - 1),
          };
        return {
          ...state,
          chainSelectedIndex: Math.max(0, state.chainSelectedIndex - 1),
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
      if (state.activeTab === 'tasks')
        return {
          ...state,
          taskSelectedIndex: Math.max(0, state.taskSelectedIndex - 1),
        };
      return state;

    case 'MOVE_DOWN':
      if (state.activeTab === 'chains') {
        if (state.chainDrillDown)
          return {
            ...state,
            chainDetailScroll: Math.min(
              action.maxIndex,
              state.chainDetailScroll + 1
            ),
          };
        return {
          ...state,
          chainSelectedIndex: Math.min(
            action.maxIndex,
            state.chainSelectedIndex + 1
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
      if (state.activeTab === 'tasks')
        return {
          ...state,
          taskSelectedIndex: Math.min(
            action.maxIndex,
            state.taskSelectedIndex + 1
          ),
        };
      return state;

    case 'ENTER':
      if (state.activeTab === 'chains' && !state.chainDrillDown)
        return { ...state, chainDrillDown: true, chainDetailScroll: 0 };
      if (state.activeTab === 'pending' && !state.pendingDrillDown)
        return { ...state, pendingDrillDown: true };
      return state;

    case 'ESCAPE':
      if (state.activeTab === 'chains' && state.chainDrillDown)
        return { ...state, chainDrillDown: false };
      if (state.activeTab === 'logs' && state.logSearchActive)
        return { ...state, logSearchActive: false, logSearch: '' };
      if (state.activeTab === 'pending' && state.pendingDrillDown)
        return { ...state, pendingDrillDown: false };
      return state;

    case 'CYCLE_CHAIN_FILTER': {
      const idx = CHAIN_FILTERS.indexOf(state.chainFilter);
      return {
        ...state,
        chainFilter: CHAIN_FILTERS[(idx + 1) % CHAIN_FILTERS.length],
        chainSelectedIndex: 0,
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
};

const STEP_FILLED: Record<ActionStepStatus, string> = {
  completed: '\u25A0',
  running: '\u25A0',
  pending: '\u25A1',
  failed: '\u25A0',
};

const LOG_STEP_COLORS: Record<string, string> = {
  event: 'yellow',
  coordinate: 'cyan',
  plan: 'magenta',
  workflow: 'blue',
  review: 'green',
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

function filterChains(
  chains: ActionChain[],
  filter: ChainFilter
): ActionChain[] {
  if (filter === 'all') return chains;
  return chains.filter(chain => {
    const hasRunningOrPending = chain.steps.some(
      s => s.status === 'running' || s.status === 'pending'
    );
    const hasFailed = chain.steps.some(s => s.status === 'failed');
    const allCompleted = chain.steps.every(s => s.status === 'completed');

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

  if (activeTab === 'chains') {
    if (state.chainDrillDown) {
      parts.push('Esc:back');
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

  parts.push('Esc:back', 'i:close');

  return (
    <Box>
      <Text dimColor>{parts.join('  ')}</Text>
    </Box>
  );
}

// ── Chains Panel ────────────────────────────────────────────────────────────

function ChainsListView({
  chains,
  selectedIndex,
  filter,
  visibleHeight,
}: {
  chains: ActionChain[];
  selectedIndex: number;
  filter: ChainFilter;
  visibleHeight: number;
}) {
  const filtered = filterChains(chains, filter);
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
        <Text dimColor> No chains match filter</Text>
      ) : (
        visible.map((chain, i) => {
          const realIndex = startIndex + i;
          const isSelected = realIndex === selectedIndex;
          return (
            <Box key={chain.chainId}>
              <Text color={isSelected ? 'cyan' : undefined}>
                {isSelected ? ' > ' : '   '}
              </Text>
              <Box>
                {chain.steps.map((step, si) => (
                  <Text key={step.actionId}>
                    <Text color={STEP_COLORS[step.status]}>
                      {STEP_FILLED[step.status]}
                    </Text>
                    {si < chain.steps.length - 1 ? (
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
                {chain.summary}
              </Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}

function ChainsDetailView({
  chain,
  traceChain,
  scroll,
  visibleHeight,
  width,
}: {
  chain: ActionChain;
  traceChain: Trace[];
  scroll: number;
  visibleHeight: number;
  width: number;
}) {
  const lines: React.ReactNode[] = [];

  // Header
  lines.push(
    <Text key="h1" bold>
      {' '}
      Chain: {chain.summary}
    </Text>
  );
  lines.push(
    <Text key="h2" dimColor>
      {' '}
      Created: {chain.createdAt}
    </Text>
  );
  lines.push(
    <Text key="sep1" dimColor>
      {' '}
      {'\u2500'.repeat(Math.max(1, width - 6))}
    </Text>
  );

  // Steps
  lines.push(
    <Text key="steps-title" bold>
      {' '}
      STEPS
    </Text>
  );
  chain.steps.forEach((step, i) => {
    lines.push(
      <Text key={`step-${step.actionId}`} wrap="truncate">
        <Text> {`${i + 1}. `}</Text>
        <Text color={STEP_COLORS[step.status]}>{STEP_FILLED[step.status]}</Text>
        <Text color={STEP_COLORS[step.status]}> {step.action.padEnd(12)}</Text>
        <Text dimColor>
          {step.status.padEnd(10)} {step.reasoning ?? 'pending'}
        </Text>
      </Text>
    );
  });

  // Trace chain
  if (traceChain.length > 0) {
    lines.push(<Text key="sep2"> </Text>);
    lines.push(
      <Text key="trace-title" bold>
        {' '}
        TRACE CHAIN
      </Text>
    );
    for (const trace of traceChain) {
      const color = LOG_STEP_COLORS[trace.step] ?? 'gray';
      lines.push(
        <Text key={`trace-${trace.id}`} wrap="truncate">
          <Text color={color}> {trace.step.padEnd(12)}</Text>
          <Text dimColor>{formatTimestamp(trace.timestamp)} </Text>
          <Text>{trace.summary}</Text>
        </Text>
      );
    }

    // Meta from the last trace
    const lastTrace = traceChain[traceChain.length - 1];
    if (lastTrace?.meta && Object.keys(lastTrace.meta).length > 0) {
      lines.push(<Text key="sep3"> </Text>);
      lines.push(
        <Text key="meta-title" bold>
          {' '}
          META
        </Text>
      );
      const metaStr = JSON.stringify(lastTrace.meta, null, 2);
      const metaLines = metaStr.split('\n');
      for (let mi = 0; mi < metaLines.length; mi++) {
        lines.push(
          <Text key={`meta-${mi}`} dimColor wrap="truncate">
            {' '}
            {metaLines[mi]}
          </Text>
        );
      }
    }
  }

  const sliced = lines.slice(scroll, scroll + visibleHeight);
  return <Box flexDirection="column">{sliced}</Box>;
}

function ChainsPanel({
  chains,
  store,
  state,
  visibleHeight,
  width,
}: {
  chains: ActionChain[];
  store: AutopilotStore;
  state: InspectorState;
  visibleHeight: number;
  width: number;
}) {
  const traceCache = useRef<Map<string, Trace[]>>(new Map());

  const filtered = filterChains(chains, state.chainFilter);
  const sorted = [...filtered].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  if (state.chainDrillDown && sorted[state.chainSelectedIndex]) {
    const chain = sorted[state.chainSelectedIndex];

    // Load trace chain if not cached
    if (!traceCache.current.has(chain.chainId)) {
      // Find a traceId from the first step's action
      const firstStep = chain.steps[0];
      if (firstStep) {
        const action = store.readAction(firstStep.actionId);
        if (action?.traceId) {
          const traces = store.getTraceChain(action.traceId);
          traceCache.current.set(chain.chainId, traces);
        } else {
          traceCache.current.set(chain.chainId, []);
        }
      }
    }

    const traceChain = traceCache.current.get(chain.chainId) ?? [];

    return (
      <ChainsDetailView
        chain={chain}
        traceChain={traceChain}
        scroll={state.chainDetailScroll}
        visibleHeight={visibleHeight}
        width={width}
      />
    );
  }

  return (
    <ChainsListView
      chains={chains}
      selectedIndex={state.chainSelectedIndex}
      filter={state.chainFilter}
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
        <Text dimColor> Chain: </Text>
        <Text>{action.chainId}</Text>
      </Text>
      <Text>
        <Text dimColor> Action ID: </Text>
        <Text>{action.actionId}</Text>
      </Text>
      <Text>
        <Text dimColor> Trace ID: </Text>
        <Text>{action.traceId}</Text>
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
            <Text key={p.actionId} wrap="truncate">
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

  useEffect(() => {
    const load = () => setMappings(store.getAllTaskMappings());
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [store]);

  const entries = Object.entries(mappings);

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
  chains,
  chainsRef: _chainsRef,
  store,
  tasks,
  width,
  height,
  onClose,
}: {
  chains: ActionChain[];
  chainsRef: React.MutableRefObject<Map<string, ActionChain>>;
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
    if (state.activeTab === 'chains') {
      const filtered = filterChains(chains, state.chainFilter);
      return Math.max(0, filtered.length - 1);
    }
    return 999; // logs use scroll, not index
  }, [state.activeTab, state.chainFilter, chains]);

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
      dispatch({ type: 'ENTER' });
      return;
    }
    if (key.escape) {
      // If in drill-down or search, go back
      if (
        (state.activeTab === 'chains' && state.chainDrillDown) ||
        (state.activeTab === 'pending' && state.pendingDrillDown) ||
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
      state.activeTab === 'chains' &&
      !state.chainDrillDown
    ) {
      dispatch({ type: 'CYCLE_CHAIN_FILTER' });
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
        {state.activeTab === 'chains' && (
          <ChainsPanel
            chains={chains}
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
