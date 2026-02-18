export type { CLIJsonOutput, CLIJsonOutputWithErrors } from './output-types.js';

export interface ProjectInstructions {
  runDev: string;
  interaction: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  status: 'pending' | 'in_progress' | 'completed';
  containerId?: string;
  lastStatusUpdate?: string;
}

export interface TaskStatus {
  taskId: string;
  status:
    | 'new'
    | 'initializing'
    | 'installing'
    | 'running'
    | 'completed'
    | 'merged'
    | 'pushed'
    | 'failed';
  currentStep: string;
  progress?: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  mergedAt?: string;
  pushedAt?: string;
  error?: string;
}

export interface TaskExpansion {
  title: string;
  description: string;
}

export interface AIProvider {
  expandTask(
    briefDescription: string,
    projectPath: string,
    contextContent?: string
  ): Promise<TaskExpansion | null>;
  expandIterationInstructions(
    instructions: string,
    previousPlan?: string,
    previousChanges?: string,
    contextContent?: string
  ): Promise<TaskExpansion | null>;
  generateCommitMessage(
    taskTitle: string,
    taskDescription: string,
    recentCommits: string[],
    summaries: string[]
  ): Promise<string | null>;
  resolveMergeConflicts(
    filePath: string,
    diffContext: string,
    conflictedContent: string
  ): Promise<string | null>;
}

/**
 * Defines the metadata for a CLI command.
 * Each command file exports a default object that satisfies this interface.
 */
export interface CommandDefinition {
  /** Command name used in CLI (e.g., 'list', 'task') */
  name: string;
  /** Parent command name for subcommands (e.g., 'workflows' for 'workflows add') */
  parent?: string;
  /** Description shown in help text */
  description: string;
  /** Whether this command requires an active project context */
  requireProject: boolean;
  /** The command action handler */
  action: (...args: any[]) => Promise<void>;
}
