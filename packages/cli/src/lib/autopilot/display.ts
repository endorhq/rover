import colors from 'ansi-colors';
import { showList, showProperties, showTips, showTitle } from 'rover-core';
import { formatDuration } from './helpers.js';
import type { AutopilotStore } from './store.js';
import type {
  AutopilotTraceInspectionOutput,
  AutopilotSpanInspectionOutput,
  AutopilotActionInspectionOutput,
} from '../../output-types.js';
import type { ActionTrace, Span, Action, TaskMapping } from './types.js';

export function stepStatusIcon(status: string): string {
  switch (status) {
    case 'completed':
      return colors.green('\u2713');
    case 'running':
      return colors.cyan('\u25B6');
    case 'pending':
      return colors.gray('\u25CB');
    case 'failed':
    case 'error':
      return colors.red('\u2717');
    default:
      return colors.gray('?');
  }
}

export function stepStatusColor(status: string): (s: string) => string {
  switch (status) {
    case 'completed':
      return colors.green;
    case 'running':
      return colors.cyan;
    case 'pending':
      return colors.gray;
    case 'failed':
    case 'error':
      return colors.red;
    default:
      return colors.white;
  }
}

function formatMeta(meta: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    result[key] =
      typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Trace
// ---------------------------------------------------------------------------

export function displayTrace(
  trace: ActionTrace,
  store: AutopilotStore,
  taskMappings: Record<string, TaskMapping>
): void {
  showTitle('Trace');

  const traceProps: Record<string, string> = {
    'Trace ID': trace.traceId,
    Summary: trace.summary,
    'Created At': new Date(trace.createdAt).toLocaleString(),
    Steps: trace.steps.length.toString(),
  };

  if (trace.retryCount != null && trace.retryCount > 0) {
    traceProps['Retry Count'] = trace.retryCount.toString();
  }

  // Find linked task mapping
  const mapping = Object.values(taskMappings).find(
    m => m.traceId === trace.traceId
  );
  if (mapping) {
    traceProps['Task ID'] = mapping.taskId.toString();
    traceProps.Branch = mapping.branchName;
  }

  showProperties(traceProps);

  // Show steps
  showTitle('Steps');

  for (let i = 0; i < trace.steps.length; i++) {
    const step = trace.steps[i];
    const icon = stepStatusIcon(step.status);
    const colorFn = stepStatusColor(step.status);
    const index = colors.gray(`[${i}]`);
    const duration =
      i + 1 < trace.steps.length
        ? formatDuration(step.timestamp, trace.steps[i + 1].timestamp)
        : formatDuration(step.timestamp);

    console.log(
      `  ${index} ${icon} ${colorFn(step.action)} ${colors.gray(`(${step.status})`)} ${colors.gray(`- ${duration}`)}`
    );

    if (step.reasoning) {
      console.log(colors.gray(`       ${step.reasoning}`));
    }

    // Show origin action and span UUIDs on separate lines
    console.log(
      colors.gray(`       Origin Action: ${step.originAction ?? '(none)'}`)
    );
    if (step.spanId) {
      console.log(colors.gray(`       Span:   ${step.spanId}`));

      // Enrich with span summary if available
      const span = store.readSpan(step.spanId);
      if (span?.summary) {
        console.log(colors.gray(`       Span summary: ${span.summary}`));
      }
    }

    // Show newActions if present
    if (step.newActions && step.newActions.length > 0) {
      console.log(
        colors.gray(`       New actions: ${step.newActions.join(', ')}`)
      );
    }
  }

  console.log();

  showTips([
    'Use ' +
      colors.cyan('rover autopilot inspect <uuid>') +
      ' to inspect a specific span or action',
  ]);
}

export function buildTraceJson(
  trace: ActionTrace,
  store: AutopilotStore,
  taskMappings: Record<string, TaskMapping>
): AutopilotTraceInspectionOutput {
  const mapping = Object.values(taskMappings).find(
    m => m.traceId === trace.traceId
  );

  const steps: Record<string, unknown>[] = [];

  for (const step of trace.steps) {
    const enriched: Record<string, unknown> = { ...step };
    if (step.spanId) {
      const span = store.readSpan(step.spanId);
      if (span) {
        enriched.span = span;
      }
    }
    if (step.originAction) {
      const action = store.readAction(step.originAction);
      if (action) {
        enriched.actionDetail = action;
      }
    }
    steps.push(enriched);
  }

  return {
    success: true,
    type: 'trace',
    traceId: trace.traceId,
    summary: trace.summary,
    createdAt: trace.createdAt,
    retryCount: trace.retryCount ?? 0,
    taskMapping: mapping ?? null,
    steps,
  };
}

// ---------------------------------------------------------------------------
// Span
// ---------------------------------------------------------------------------

export function displaySpan(span: Span, parentTrace: Span[]): void {
  showTitle(`Span: ${span.id}`);

  const spanProps: Record<string, string> = {
    'Span ID': span.id,
    Step: span.step,
    Status: span.status
      ? stepStatusColor(span.status)(span.status)
      : colors.gray('unknown'),
    'Started At': new Date(span.timestamp).toLocaleString(),
  };

  if (span.completed) {
    spanProps['Completed At'] = new Date(span.completed).toLocaleString();
    spanProps.Duration = formatDuration(span.timestamp, span.completed);
  }

  if (span.summary) {
    spanProps.Summary = span.summary;
  }

  if (span.parent) {
    spanProps['Parent Span'] = span.parent;
  }

  if (span.originAction) {
    spanProps['Origin Action'] = span.originAction;
  }

  if (span.newActions && span.newActions.length > 0) {
    spanProps['New Actions'] = span.newActions.join(', ');
  }

  showProperties(spanProps);

  // Show metadata if present
  if (span.meta && Object.keys(span.meta).length > 0) {
    showTitle('Metadata');
    showProperties(formatMeta(span.meta));
  }

  // Show parent chain if there are ancestors
  if (parentTrace.length > 1) {
    showTitle('Parent Chain');
    const chain = parentTrace.map((s, i) => {
      const prefix =
        i === parentTrace.length - 1 ? colors.cyan('\u25B6 ') : '  ';
      const status = s.status
        ? stepStatusColor(s.status)(s.status)
        : colors.gray('unknown');
      return `${prefix}${s.step} ${colors.gray(`(${s.id})`)} ${status}`;
    });
    showList(chain);
  }

  showTips([
    'Use ' +
      colors.cyan('rover autopilot inspect <traceId>') +
      ' to inspect the full trace',
  ]);
}

export function buildSpanJson(
  span: Span,
  parentTrace: Span[]
): AutopilotSpanInspectionOutput {
  return {
    success: true,
    type: 'span',
    ...span,
    parentTrace: parentTrace.length > 1 ? parentTrace : undefined,
  };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export function displayAction(action: Action, linkedSpan: Span | null): void {
  showTitle(`Action: ${action.id}`);

  const actionProps: Record<string, string> = {
    'Action ID': action.id,
    Action: action.action,
    'Created At': new Date(action.timestamp).toLocaleString(),
    'Span ID': action.spanId,
  };

  if (action.reasoning) {
    actionProps.Reasoning = action.reasoning;
  }

  showProperties(actionProps);

  // Show metadata if present
  if (action.meta && Object.keys(action.meta).length > 0) {
    showTitle('Metadata');
    showProperties(formatMeta(action.meta));
  }

  // Show linked span context
  if (linkedSpan) {
    showTitle('Linked Span');
    const spanProps: Record<string, string> = {
      'Span ID': linkedSpan.id,
      Step: linkedSpan.step,
      Status: linkedSpan.status
        ? stepStatusColor(linkedSpan.status)(linkedSpan.status)
        : colors.gray('unknown'),
    };
    if (linkedSpan.summary) {
      spanProps.Summary = linkedSpan.summary;
    }
    showProperties(spanProps);
  }

  showTips([
    'Use ' +
      colors.cyan(`rover autopilot inspect ${action.spanId}`) +
      ' to inspect the linked span',
  ]);
}

export function buildActionJson(
  action: Action,
  linkedSpan: Span | null
): AutopilotActionInspectionOutput {
  return {
    success: true,
    type: 'action',
    ...action,
    linkedSpan,
  };
}
