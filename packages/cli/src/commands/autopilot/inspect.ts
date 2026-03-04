import colors from 'ansi-colors';
import { showList, showProperties, showTips, showTitle } from 'rover-core';
import { getTelemetry } from '../../lib/telemetry.js';
import {
  isJsonMode,
  setJsonMode,
  requireProjectContext,
} from '../../lib/context.js';
import { exitWithError, exitWithSuccess } from '../../utils/exit.js';
import { AutopilotStore } from '../../lib/autopilot/store.js';
import { formatDuration } from '../../lib/autopilot/helpers.js';
import type { CLIJsonOutput, CommandDefinition } from '../../types.js';
import type {
  ActionTrace,
  Span,
  Action,
  TaskMapping,
} from '../../lib/autopilot/types.js';

const VALID_TYPES = ['trace', 'span', 'action'] as const;
type InspectType = (typeof VALID_TYPES)[number];

function stepStatusIcon(status: string): string {
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

function stepStatusColor(status: string): (s: string) => string {
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
// Trace inspection
// ---------------------------------------------------------------------------

function displayTrace(
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
      colors.cyan('rover autopilot inspect span <spanId>') +
      ' to inspect a specific span',
    'Use ' +
      colors.cyan('rover autopilot inspect action <actionId>') +
      ' to inspect a specific action',
  ]);
}

function buildTraceJson(
  trace: ActionTrace,
  store: AutopilotStore,
  taskMappings: Record<string, TaskMapping>
): CLIJsonOutput & Record<string, unknown> {
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
// Span inspection
// ---------------------------------------------------------------------------

function displaySpan(span: Span, parentTrace: Span[]): void {
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
      colors.cyan('rover autopilot inspect trace <traceId>') +
      ' to inspect the full trace',
  ]);
}

function buildSpanJson(span: Span, parentTrace: Span[]): CLIJsonOutput & Record<string, unknown> {
  return {
    success: true,
    type: 'span',
    ...span,
    parentTrace: parentTrace.length > 1 ? parentTrace : undefined,
  };
}

// ---------------------------------------------------------------------------
// Action inspection
// ---------------------------------------------------------------------------

function displayAction(action: Action, linkedSpan: Span | null): void {
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
      colors.cyan(`rover autopilot inspect span ${action.spanId}`) +
      ' to inspect the linked span',
  ]);
}

function buildActionJson(
  action: Action,
  linkedSpan: Span | null
): CLIJsonOutput & Record<string, unknown> {
  return {
    success: true,
    type: 'action',
    ...action,
    linkedSpan,
  };
}

// ---------------------------------------------------------------------------
// Main command handler
// ---------------------------------------------------------------------------

const inspectAutopilotCommand = async (
  type: string,
  uuid: string,
  options: { json?: boolean; projectId?: string } = {}
) => {
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

  const telemetry = getTelemetry();

  // Validate the type argument
  if (!VALID_TYPES.includes(type as InspectType)) {
    exitWithError(
      {
        success: false,
        error: `Invalid type "${type}". Valid types are: ${VALID_TYPES.join(', ')}`,
      },
      {
        tips: [
          'Use ' +
            colors.cyan('rover autopilot inspect trace <id>') +
            ' to inspect a trace',
          'Use ' +
            colors.cyan('rover autopilot inspect span <id>') +
            ' to inspect a span',
          'Use ' +
            colors.cyan('rover autopilot inspect action <id>') +
            ' to inspect an action',
        ],
        telemetry,
      }
    );
    return;
  }

  // Require project context (use --project-id override if provided)
  let project: Awaited<ReturnType<typeof requireProjectContext>> | undefined;
  try {
    project = await requireProjectContext(options.projectId);
  } catch (error) {
    exitWithError(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { telemetry }
    );
    return;
  }

  const store = new AutopilotStore(project.id);

  switch (type as InspectType) {
    case 'trace': {
      const traces = store.loadTraces();
      const trace = traces.get(uuid);

      if (!trace) {
        exitWithError(
          {
            success: false,
            error: `Trace "${uuid}" not found in project "${project.name}" (${project.id})`,
          },
          {
            tips: [
              'Use ' +
                colors.cyan('rover autopilot') +
                ' to view all active traces in the dashboard',
            ],
            telemetry,
          }
        );
        return;
      }

      const taskMappings = store.getAllTaskMappings();

      if (isJsonMode()) {
        const json = buildTraceJson(trace, store, taskMappings);
        await exitWithSuccess(null, json, { telemetry });
      } else {
        displayTrace(trace, store, taskMappings);
        await exitWithSuccess(null, { success: true }, { telemetry });
      }
      break;
    }

    case 'span': {
      const span = store.readSpan(uuid);

      if (!span) {
        exitWithError(
          {
            success: false,
            error: `Span "${uuid}" not found in project "${project.name}" (${project.id})`,
          },
          {
            tips: [
              'Use ' +
                colors.cyan('rover autopilot inspect trace <traceId>') +
                ' to find span IDs within a trace',
            ],
            telemetry,
          }
        );
        return;
      }

      const parentTrace = store.getSpanTrace(uuid);

      if (isJsonMode()) {
        const json = buildSpanJson(span, parentTrace);
        await exitWithSuccess(null, json, { telemetry });
      } else {
        displaySpan(span, parentTrace);
        await exitWithSuccess(null, { success: true }, { telemetry });
      }
      break;
    }

    case 'action': {
      const action = store.readAction(uuid);

      if (!action) {
        exitWithError(
          {
            success: false,
            error: `Action "${uuid}" not found in project "${project.name}" (${project.id})`,
          },
          {
            tips: [
              'Use ' +
                colors.cyan('rover autopilot inspect trace <traceId>') +
                ' to find action IDs within a trace',
            ],
            telemetry,
          }
        );
        return;
      }

      const linkedSpan = store.readSpan(action.spanId);

      if (isJsonMode()) {
        const json = buildActionJson(action, linkedSpan);
        await exitWithSuccess(null, json, { telemetry });
      } else {
        displayAction(action, linkedSpan);
        await exitWithSuccess(null, { success: true }, { telemetry });
      }
      break;
    }
  }
};

export default {
  name: 'inspect',
  parent: 'autopilot',
  description: 'Inspect autopilot traces, spans, or actions by UUID',
  requireProject: true,
  action: inspectAutopilotCommand,
} satisfies CommandDefinition;
