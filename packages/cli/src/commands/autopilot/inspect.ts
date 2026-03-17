import colors from 'ansi-colors';
import { getTelemetry } from '../../lib/telemetry.js';
import {
  isJsonMode,
  setJsonMode,
  requireProjectContext,
} from '../../lib/context.js';
import { exitWithError, exitWithSuccess } from '../../utils/exit.js';
import { AutopilotStore } from '../../lib/autopilot/store.js';
import {
  displayTrace,
  displaySpan,
  displayAction,
  buildTraceJson,
  buildSpanJson,
  buildActionJson,
} from '../../lib/autopilot/display.js';
import type { CommandDefinition } from '../../types.js';

const inspectAutopilotCommand = async (
  uuid: string,
  options: { json?: boolean; projectId?: string } = {}
) => {
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

  const telemetry = getTelemetry();

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

  // Auto-detect: try trace, then span, then action
  const traces = store.loadTraces();
  const trace = traces.get(uuid);
  if (trace) {
    const taskMappings = store.getAllTaskMappings();

    if (isJsonMode()) {
      const json = buildTraceJson(trace, store, taskMappings);
      await exitWithSuccess(null, json, { telemetry });
    } else {
      displayTrace(trace, store, taskMappings);
      await exitWithSuccess(null, { success: true }, { telemetry });
    }
    return;
  }

  const span = store.readSpan(uuid);
  if (span) {
    const parentTrace = store.getSpanTrace(uuid);

    if (isJsonMode()) {
      const json = buildSpanJson(span, parentTrace);
      await exitWithSuccess(null, json, { telemetry });
    } else {
      displaySpan(span, parentTrace);
      await exitWithSuccess(null, { success: true }, { telemetry });
    }
    return;
  }

  const action = store.readAction(uuid);
  if (action) {
    const linkedSpan = store.readSpan(action.spanId);

    if (isJsonMode()) {
      const json = buildActionJson(action, linkedSpan);
      await exitWithSuccess(null, json, { telemetry });
    } else {
      displayAction(action, linkedSpan);
      await exitWithSuccess(null, { success: true }, { telemetry });
    }
    return;
  }

  exitWithError(
    {
      success: false,
      error: `UUID "${uuid}" not found as a trace, span, or action in project "${project.name}" (${project.id})`,
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
};

// Named export for testing
export { inspectAutopilotCommand };

export default {
  name: 'inspect',
  parent: 'autopilot',
  description: 'Inspect an autopilot trace, span, or action by UUID',
  requireProject: true,
  action: inspectAutopilotCommand,
} satisfies CommandDefinition;
