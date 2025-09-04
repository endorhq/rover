import { LANGUAGE, PACKAGE_MANAGER, TASK_MANAGER } from './lib/config.js';

export interface ProjectInstructions {
  runDev: string;
  interaction: string;
}

export interface CLIJsonOutput {
  success: boolean;
  error?: string;
}

export interface CLIJsonOutputWithErrors {
  success: boolean;
  errors: string[];
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

export interface Environment {
  languages: LANGUAGE[];
  packageManagers: PACKAGE_MANAGER[];
  taskManagers: TASK_MANAGER[];
}

export interface AIProvider {
  expandTask(
    briefDescription: string,
    projectPath: string
  ): Promise<TaskExpansion | null>;
  expandIterationInstructions(
    instructions: string,
    previousPlan?: string,
    previousChanges?: string
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
