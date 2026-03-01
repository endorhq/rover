import colors from 'ansi-colors';
import {
  type GroupDefinition,
  type IterationManager,
  type IterationStatusManager,
  ProjectConfigManager,
  type ProjectManager,
  ProjectStore,
  showTips,
  Table,
  type TableColumn,
  type TaskDescriptionManager,
  UserSettingsManager,
  VERBOSE,
} from 'rover-core';
import type { GlobalProject, TaskDescription } from 'rover-schemas';
import {
  isJsonMode,
  isProjectMode,
  setJsonMode,
  resolveProjectContext,
} from '../lib/context.js';
import { executeHooks } from '../lib/hooks.js';
import { getTelemetry } from '../lib/telemetry.js';
import { formatTaskStatus, statusColor } from '../utils/task-status.js';
import type { ListTasksOutput } from '../output-types.js';
import type { CommandDefinition } from '../types.js';
import { detectOrphanedTasks } from '../lib/orphan-detector.js';
import { RetryScheduler } from '../lib/retry-scheduler.js';

/**
 * Format duration from start to now or completion
 */
const formatDuration = (startTime?: string, endTime?: string): string => {
  if (!startTime) {
    return 'never';
  }

  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date();
  const diffMs = end.getTime() - start.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
};

/**
 * Format progress bar
 */
const formatProgress = (step?: string, progress?: number): string => {
  if (step === undefined || progress === undefined) return colors.gray('─────');

  const barLength = 8;
  const filled = Math.max(
    0,
    Math.min(barLength, Math.round((progress / 100) * barLength))
  );
  const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

  if (step === 'FAILED') {
    return colors.red(bar);
  } else if (['COMPLETED', 'MERGED', 'PUSHED'].includes(step)) {
    return colors.green(bar);
  } else if (step === 'PAUSED') {
    return colors.yellow(bar);
  } else {
    return colors.cyan(bar);
  }
};

/**
 * Row data for the table
 */
interface TaskRow {
  id: string;
  title: string;
  agent: string;
  workflow: string;
  status: string;
  progress: number;
  currentStep: string;
  duration: string;
  error?: string;
  /** AI provider that caused the pause (for display purposes) */
  provider?: string;
  /** Group ID for grouped rendering (project ID in global mode) */
  groupId?: string;
}

/**
 * Task with associated project metadata for multi-project listing
 */
interface TaskWithProject {
  task: TaskDescriptionManager;
  project: ProjectManager | null;
}

/**
 * Helper to safely get iteration status
 */
const maybeIterationStatus = (
  iteration?: IterationManager
): IterationStatusManager | undefined => {
  try {
    return iteration?.status();
  } catch {
    return undefined;
  }
};

/**
 * Build a TaskRow from a task and optional project info
 */
const buildTaskRow = (
  task: TaskDescriptionManager,
  groupId?: string,
  retryScheduler?: RetryScheduler,
  project?: ProjectManager | null
): TaskRow => {
  const lastIteration = task.getLastIteration();
  const taskStatus = task.status;
  const startedAt = task.startedAt;

  // Determine end time based on task status
  let endTime: string | undefined;
  if (taskStatus === 'FAILED') {
    endTime = task.failedAt;
  } else if (taskStatus === 'PAUSED') {
    endTime = task.pausedAt;
  } else if (['COMPLETED', 'MERGED', 'PUSHED'].includes(taskStatus)) {
    endTime = task.completedAt;
  }

  const iterationStatus = maybeIterationStatus(lastIteration);

  // Format agent with model (e.g., "claude:sonnet")
  let agentDisplay = task.agent || '-';
  if (task.agent && task.agentModel) {
    agentDisplay = `${task.agent}:${task.agentModel}`;
  }

  // Resolve provider for paused tasks
  const pauseProvider =
    taskStatus === 'PAUSED'
      ? iterationStatus?.provider || task.agent || undefined
      : undefined;

  // For paused tasks, show retry time instead of step name
  let currentStepDisplay = iterationStatus?.currentStep || '-';
  if (taskStatus === 'PAUSED' && retryScheduler && pauseProvider) {
    // Only show the task-specific retry time; don't fall back to provider-wide
    // time which could show another task's scheduled retry.
    const retryTime = project
      ? retryScheduler.getScheduledTimeForTask(project, task.id)
      : undefined;
    if (retryTime) {
      const timeStr = retryTime.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      currentStepDisplay = `retry at ${timeStr}`;
    }
  }

  return {
    id: task.id.toString(),
    title: task.title || 'Unknown Task',
    agent: agentDisplay,
    workflow: task.workflowName || '-',
    status: taskStatus,
    progress: iterationStatus?.progress || 0,
    currentStep: currentStepDisplay,
    duration: iterationStatus ? formatDuration(startedAt, endTime) : '-',
    error: task.error,
    provider: pauseProvider,
    groupId,
  };
};

/**
 * List all tasks in the current project or across all registered projects.
 *
 * Displays a table of tasks with their IDs, titles, agents, workflows, status,
 * progress, and duration. In project context, shows tasks for that project.
 * In global context (outside any project), shows tasks grouped by project.
 * Supports watch mode for real-time status updates and triggers onComplete hooks.
 *
 * @param options - Command options
 * @param options.watch - Enable watch mode with optional refresh interval in seconds
 * @param options.verbose - Show additional details including error messages
 * @param options.json - Output results in JSON format
 * @param options.watching - Internal flag indicating active watch mode cycle
 */
const listCommand = async (
  options: {
    watch?: boolean | string;
    verbose?: boolean;
    json?: boolean;
    watching?: boolean;
    /** Internal: retry scheduler passed through from watch mode */
    _retryScheduler?: RetryScheduler;
    /** Internal: mutable ref for orphan detection throttle (shared across watch cycles) */
    _orphanDetectRef?: { lastAt: number };
  } = {}
) => {
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

  const telemetry = getTelemetry();

  try {
    // Get project context (may be null in global mode)
    const project = await resolveProjectContext();

    // Collect tasks and project metadata
    let tasksWithProjects: TaskWithProject[] = [];

    if (project) {
      // Scoped mode: single project
      const tasks = project.listTasks();
      tasksWithProjects = tasks.map(task => ({
        task,
        project,
      }));
    } else {
      // Global mode: fetch tasks from all registered projects
      const store = new ProjectStore();

      for (const projectData of store.list()) {
        try {
          const projectManager = store.get(projectData.id);
          if (projectManager) {
            const tasks = projectManager.listTasks();
            for (const task of tasks) {
              tasksWithProjects.push({ task, project: projectManager });
            }
          }
        } catch (err) {
          if (VERBOSE) {
            console.error(
              colors.gray(
                `Failed to load tasks for project ${projectData.id}: ${err}`
              )
            );
          }
        }
      }
    }

    if (!options.watching) {
      telemetry?.eventListTasks();
    }

    if (tasksWithProjects.length === 0) {
      if (isJsonMode()) {
        console.log(JSON.stringify([]));
      } else {
        if (project) {
          console.log(colors.yellow('📋 No tasks found'));
        } else {
          console.log(colors.yellow('📋 No tasks found across all projects'));
        }

        if (!options.watch) {
          showTips(
            'Use ' +
              colors.cyan('rover task') +
              ' to assign a new task to an agent'
          );
        }
      }

      // Don't return early if in watch mode - continue to watch for new tasks
      if (!options.watch) {
        return;
      }
    }

    const refreshedTasksWithProjects: TaskWithProject[] = [];
    const orphanCandidates: TaskWithProject[] = [];
    for (const { task, project: projectData } of tasksWithProjects) {
      try {
        task.updateStatusFromIteration();
        orphanCandidates.push({ task, project: projectData });
        refreshedTasksWithProjects.push({ task, project: projectData });
      } catch (err) {
        if (!isJsonMode()) {
          console.log(
            `\n${colors.yellow(`⚠ Failed to update the status of task ${task.id}`)}`
          );
        }

        if (VERBOSE) {
          console.error(colors.gray(`Error details: ${err}`));
        }
      }
    }

    // Detect orphaned IN_PROGRESS/ITERATING tasks whose container died.
    // Throttle to every 30 seconds in watch mode since each detection round
    // involves container inspect calls that can be slow with many tasks.
    const ORPHAN_DETECT_INTERVAL_MS = 30_000;
    const now = Date.now();
    const orphanRef = options._orphanDetectRef;
    if (
      !options.watching ||
      !orphanRef ||
      now - orphanRef.lastAt >= ORPHAN_DETECT_INTERVAL_MS
    ) {
      await detectOrphanedTasks(orphanCandidates, {
        suppressWarnings: isJsonMode(),
      });
      if (orphanRef) {
        orphanRef.lastAt = now;
      }
    }

    // Use refreshed task state for scheduler updates and onComplete hooks.
    const retryScheduler = options._retryScheduler;
    for (const { task, project: projectData } of refreshedTasksWithProjects) {
      try {
        const currentStatus = task.status;

        // Auto-retry integration: register/unregister paused tasks
        if (retryScheduler && projectData) {
          if (currentStatus === 'PAUSED') {
            const lastIteration = task.getLastIteration();
            const iterStatus = maybeIterationStatus(lastIteration);
            const provider = iterStatus?.provider || task.agent || 'unknown';
            retryScheduler.registerPausedTask(provider, task.id, projectData);
          } else {
            // If task was paused but is no longer, unregister
            const provider =
              maybeIterationStatus(task.getLastIteration())?.provider ||
              task.agent ||
              'unknown';
            retryScheduler.unregisterTask(provider, task.id, projectData);
          }
        }

        // Check if this is a terminal status that should trigger onComplete hooks
        const isTerminalStatus =
          currentStatus === 'COMPLETED' || currentStatus === 'FAILED';

        // Check if hook has already been fired for this status transition
        const hookAlreadyFired =
          task.onCompleteHookFiredAt === task.lastStatusCheck;

        // Load project config for hooks per project
        let projectConfig: ProjectConfigManager | undefined;
        if (projectData) {
          projectConfig = ProjectConfigManager.load(projectData.path);
        }

        // Execute onComplete hooks if configured and not already fired for this status
        if (
          isTerminalStatus &&
          !hookAlreadyFired &&
          projectConfig?.hooks?.onComplete?.length &&
          projectData?.path
        ) {
          executeHooks(
            projectConfig.hooks.onComplete,
            {
              taskId: task.id,
              taskBranch: task.branchName,
              taskTitle: task.title,
              taskStatus: currentStatus.toLowerCase(),
              projectPath: projectData.path,
            },
            'onComplete'
          );

          // Record that hook was fired for this status transition (persists to task file)
          task.setOnCompleteHookFiredAt(task.lastStatusCheck!);
        }
      } catch (err) {
        if (!isJsonMode()) {
          console.log(
            `\n${colors.yellow(`⚠ Failed to update the status of task ${task.id}`)}`
          );
        }

        if (VERBOSE) {
          console.error(colors.gray(`Error details: ${err}`));
        }
      }
    }

    // JSON output mode
    if (isJsonMode()) {
      const jsonOutput: ListTasksOutput = [];

      for (const { task, project: projectData } of tasksWithProjects) {
        let iterationsData: IterationManager[] = [];
        try {
          iterationsData = task.getIterations();
        } catch (err) {
          if (VERBOSE) {
            console.error(
              colors.gray(
                `Failed to retrieve the iterations details for task ${task.id}`
              )
            );
            console.error(colors.gray(`Error details: ${err}`));
          }
        }

        jsonOutput.push({
          ...task.rawData,
          iterationsData,
          projectId: projectData?.id ?? project?.id,
        });
      }

      console.log(JSON.stringify(jsonOutput, null, 2));
      return;
    }

    // Prepare table data
    const tableData: TaskRow[] = tasksWithProjects.map(
      ({ task, project: projectData }) =>
        buildTaskRow(task, projectData?.id, retryScheduler, projectData)
    );

    // Define table columns
    const columns: TableColumn<TaskRow>[] = [
      {
        header: 'ID',
        key: 'id',
        maxWidth: 4,
        format: (value: string) => colors.cyan(value),
      },
      {
        header: 'Title',
        key: 'title',
        minWidth: 15,
        maxWidth: 30,
        truncate: 'ellipsis',
      },
      {
        header: 'Agent',
        key: 'agent',
        minWidth: 8,
        maxWidth: 16,
        truncate: 'ellipsis',
        format: (value: string) => colors.gray(value),
      },
      {
        header: 'Workflow',
        key: 'workflow',
        minWidth: 8,
        maxWidth: 12,
        truncate: 'ellipsis',
        format: (value: string) => colors.gray(value),
      },
      {
        header: 'Status',
        key: 'status',
        width: 20,
        format: (value: string, row: TaskRow) => {
          const colorFunc = statusColor(value);
          return colorFunc(formatTaskStatus(value, row.provider));
        },
      },
      {
        header: 'Progress',
        key: 'progress',
        format: (_value: string, row: TaskRow) =>
          formatProgress(row.status, row.progress),
        width: 10,
      },
      {
        header: 'Current Step',
        key: 'currentStep',
        minWidth: 15,
        maxWidth: 25,
        truncate: 'ellipsis',
        format: (value: string) => colors.gray(value),
      },
      {
        header: 'Duration',
        key: 'duration',
        width: 10,
        format: (value: string) => colors.gray(value),
      },
    ];

    // Build groups for global mode
    let groups: GroupDefinition[] | undefined;
    if (!project) {
      // Build groups from projects that have tasks (dedupe by project id)
      const seenProjectIds = new Set<string>();
      groups = [];
      for (const { project: projectData } of tasksWithProjects) {
        if (projectData && !seenProjectIds.has(projectData.id)) {
          seenProjectIds.add(projectData.id);
          groups.push({
            id: projectData.id,
            title: ` ${colors.cyan('◈')} ${colors.cyan(projectData.name)} ${colors.gray(projectData.path)}`,
          });
        }
      }
    }

    // Add a breakline
    console.log();

    // Render the table
    const table = new Table(columns, { groups });
    table.render(tableData);

    // Show errors in verbose mode
    if (options.verbose) {
      tableData.forEach(row => {
        if (row.error) {
          console.log(colors.red(`    Error for task ${row.id}: ${row.error}`));
        }
      });
    }

    // Watch mode (configurable refresh interval, default 3 seconds)
    if (options.watch && !options._retryScheduler) {
      // Create a retry scheduler for auto-resuming paused tasks (only once, on the initial watch call)
      options._retryScheduler = new RetryScheduler({ quiet: isJsonMode() });
    }

    if (options.watch) {
      // CLI argument takes precedence, then settings, then default (3s)
      let intervalSeconds: number;
      if (typeof options.watch === 'string') {
        intervalSeconds = parseInt(options.watch, 10);
        if (
          isNaN(intervalSeconds) ||
          intervalSeconds < 1 ||
          intervalSeconds > 60
        ) {
          console.error(
            colors.red('Watch interval must be between 1 and 60 seconds')
          );
          return;
        }
      } else {
        // Default watch interval (3 seconds) if no project context
        const DEFAULT_WATCH_INTERVAL = 3;
        if (project?.path) {
          try {
            const settings = UserSettingsManager.load(project.path);
            intervalSeconds = settings.watchIntervalSeconds;
          } catch {
            intervalSeconds = DEFAULT_WATCH_INTERVAL;
          }
        } else {
          intervalSeconds = DEFAULT_WATCH_INTERVAL;
        }
      }
      const intervalMs = intervalSeconds * 1000;

      console.log(
        colors.gray(
          `\n⏱️  Watching for changes every ${intervalSeconds}s (Ctrl+C to exit)...\n` +
            `    Paused tasks will auto-retry when credits reset (up to 5 attempts).`
        )
      );

      const watchScheduler = options._retryScheduler;
      // Mutable ref shared across watch cycles so the orphan detection
      // throttle persists between recursive listCommand calls.
      const orphanDetectRef = { lastAt: 0 };
      let watchTimeout: ReturnType<typeof setTimeout> | undefined;
      let stopping = false;
      let consecutiveErrors = 0;
      const MAX_CONSECUTIVE_ERRORS = 10;

      // Use setTimeout chain instead of setInterval to prevent overlapping
      // refresh cycles when a refresh takes longer than the interval.
      const scheduleRefresh = () => {
        if (stopping) return;
        watchTimeout = setTimeout(async () => {
          try {
            process.stdout.write('\x1b[2J\x1b[0f');
            await listCommand({
              ...options,
              watch: false,
              watching: true,
              _retryScheduler: watchScheduler,
              _orphanDetectRef: orphanDetectRef,
            });
            console.log(
              colors.gray(
                `\n⏱️  Refreshing every ${intervalSeconds}s (Ctrl+C to exit)...`
              )
            );
            consecutiveErrors = 0;
          } catch (err) {
            consecutiveErrors++;
            console.error(
              colors.red(
                `Error during watch refresh: ${err instanceof Error ? err.message : String(err)}`
              )
            );
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              console.error(
                colors.red(
                  `\nToo many consecutive refresh errors (${MAX_CONSECUTIVE_ERRORS}), stopping watch mode.`
                )
              );
              stopping = true;
              return;
            }
          }
          scheduleRefresh();
        }, intervalMs);
      };
      scheduleRefresh();

      const cleanup = () => {
        stopping = true;
        if (watchTimeout) clearTimeout(watchTimeout);
        watchScheduler?.destroy();
      };

      // Handle Ctrl+C (once — handler is only registered on the initial watch call)
      process.once('SIGINT', () => {
        cleanup();
        // Allow event loop to drain (telemetry shutdown in finally block)
        // instead of calling process.exit(0) which skips async cleanup.
        process.exitCode = 0;
      });

      // Safety net: ensure timers are cleaned up on any exit path
      // (uncaught exceptions, SIGTERM, etc.)
      process.once('SIGTERM', cleanup);
      process.once('exit', cleanup);
    }

    if (!options.watch && !options.watching) {
      showTips([
        'Use ' +
          colors.cyan('rover task') +
          ' to assign a new task to an agent',
        'Use ' + colors.cyan('rover inspect <id>') + ' to see the task details',
      ]);
    }
  } catch (error) {
    console.error(colors.red('Error getting task status:'), error);
  } finally {
    await telemetry?.shutdown();
  }
};

// Named export for backwards compatibility (used by tests)
export { listCommand };

export default {
  name: 'list',
  description: 'Show the tasks from current project or all projects',
  requireProject: false,
  action: listCommand,
} satisfies CommandDefinition;
