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
import type { CommandDefinition } from '../types.js';

/**
 * Track previous task statuses to detect transitions for onComplete hooks.
 * Module-level to persist across watch mode polling cycles.
 */
const previousTaskStatuses = new Map<number, string>();

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
  const filled = Math.round((progress / 100) * barLength);
  const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);

  if (step === 'FAILED') {
    return colors.red(bar);
  } else if (['COMPLETED', 'MERGED', 'PUSHED'].includes(step)) {
    return colors.green(bar);
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
  groupId?: string
): TaskRow => {
  const lastIteration = task.getLastIteration();
  const taskStatus = task.status;
  const startedAt = task.startedAt;

  // Determine end time based on task status
  let endTime: string | undefined;
  if (taskStatus === 'FAILED') {
    endTime = task.failedAt;
  } else if (['COMPLETED', 'MERGED', 'PUSHED'].includes(taskStatus)) {
    endTime = task.completedAt;
  }

  const iterationStatus = maybeIterationStatus(lastIteration);

  // Format agent with model (e.g., "claude:sonnet")
  let agentDisplay = task.agent || '-';
  if (task.agent && task.agentModel) {
    agentDisplay = `${task.agent}:${task.agentModel}`;
  }

  return {
    id: task.id.toString(),
    title: task.title || 'Unknown Task',
    agent: agentDisplay,
    workflow: task.workflowName || '-',
    status: taskStatus,
    progress: iterationStatus?.progress || 0,
    currentStep: iterationStatus?.currentStep || '-',
    duration: iterationStatus ? formatDuration(startedAt, endTime) : '-',
    error: task.error,
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

    // Update task status and detect transitions for onComplete hooks
    // (hooks only apply in single-project context)
    for (const { task, project: projectData } of tasksWithProjects) {
      try {
        // Get previous status before update
        const previousStatus = previousTaskStatuses.get(task.id);

        // Update status from iteration
        task.updateStatusFromIteration();
        const currentStatus = task.status;

        // Detect NEW transition to COMPLETED or FAILED
        const isNewCompletion =
          previousStatus !== currentStatus &&
          (currentStatus === 'COMPLETED' || currentStatus === 'FAILED');

        // Load project config for hooks per project
        let projectConfig: ProjectConfigManager | undefined;
        if (projectData) {
          try {
            projectConfig = ProjectConfigManager.load(projectData.path);
          } catch {
            // Project config is optional, continue without hooks
          }
        }

        // Execute onComplete hooks if configured and this is a new completion
        // Only execute hooks in single-project mode
        if (
          isNewCompletion &&
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
        }

        // Update tracking for next iteration
        previousTaskStatuses.set(task.id, currentStatus);
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
      const jsonOutput: Array<
        TaskDescription & {
          iterationsData: IterationManager[];
          projectId?: string;
        }
      > = [];

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
      ({ task, project: projectData }) => buildTaskRow(task, projectData?.id)
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
        width: 12,
        format: (value: string) => {
          const colorFunc = statusColor(value);
          return colorFunc(formatTaskStatus(value));
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
          `\n⏱️  Watching for changes every ${intervalSeconds}s (Ctrl+C to exit)...`
        )
      );

      const watchInterval = setInterval(async () => {
        // Clear screen and show updated status
        process.stdout.write('\x1b[2J\x1b[0f');
        await listCommand({ ...options, watch: false, watching: true });
        console.log(
          colors.gray(
            `\n⏱️  Refreshing every ${intervalSeconds}s (Ctrl+C to exit)...`
          )
        );
      }, intervalMs);

      // Handle Ctrl+C
      process.on('SIGINT', () => {
        clearInterval(watchInterval);
        process.exit(0);
      });
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
