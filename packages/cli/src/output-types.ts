/**
 * Centralized types for CLI structured JSON output (--json flag).
 * All types that shape command output when --json is used live here.
 */

import type { IterationManager, WorkflowSource } from 'rover-core';
import type {
  TaskDescription,
  TaskStatus as SchemaTaskStatus,
  Workflow,
} from 'rover-schemas';

// ---------------------------------------------------------------------------
// Base types (used by exit helpers and extended by command outputs)
// ---------------------------------------------------------------------------

export interface CLIJsonOutput {
  success: boolean;
  error?: string;
}

export interface CLIJsonOutputWithErrors {
  success: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// task command
// ---------------------------------------------------------------------------

export interface TaskTaskOutputItem {
  taskId: number;
  agent: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
  startedAt: string;
  workspace: string;
  branch: string;
  savedTo: string;
}

export interface TaskTaskOutputContextItem {
  name: string;
  uri: string;
  description: string;
}

export interface TaskTaskOutput extends CLIJsonOutput {
  taskId?: number;
  title?: string;
  description?: string;
  status?: string;
  createdAt?: string;
  startedAt?: string;
  workspace?: string;
  branch?: string;
  savedTo?: string;
  context?: TaskTaskOutputContextItem[];
  tasks?: TaskTaskOutputItem[];
}

// ---------------------------------------------------------------------------
// list command
// ---------------------------------------------------------------------------

export interface ListTasksOutputItem extends TaskDescription {
  iterationsData: IterationManager[];
  projectId?: string;
}

export type ListTasksOutput = ListTasksOutputItem[];

// ---------------------------------------------------------------------------
// stop command
// ---------------------------------------------------------------------------

export interface TaskStopOutput extends CLIJsonOutput {
  taskId?: number;
  title?: string;
  status?: string;
  stoppedAt?: string;
}

// ---------------------------------------------------------------------------
// restart command
// ---------------------------------------------------------------------------

export interface TaskRestartOutput extends CLIJsonOutput {
  taskId?: number;
  title?: string;
  description?: string;
  status?: string;
  restartedAt?: string;
}

// ---------------------------------------------------------------------------
// merge command
// ---------------------------------------------------------------------------

export interface TaskMergeOutput extends CLIJsonOutput {
  taskId?: number;
  taskTitle?: string;
  branchName?: string;
  currentBranch?: string;
  hasWorktreeChanges?: boolean;
  hasUnmergedCommits?: boolean;
  committed?: boolean;
  commitMessage?: string;
  merged?: boolean;
  conflictsResolved?: boolean;
  cleanedUp?: boolean;
}

// ---------------------------------------------------------------------------
// push command
// ---------------------------------------------------------------------------

export interface TaskPushOutput extends CLIJsonOutput {
  taskId: number;
  taskTitle: string;
  branchName: string;
  hasChanges: boolean;
  committed: boolean;
  commitMessage?: string;
  pushed: boolean;
}

// ---------------------------------------------------------------------------
// logs command
// ---------------------------------------------------------------------------

export interface TaskLogsOutput extends CLIJsonOutput {
  logs: string;
}

// ---------------------------------------------------------------------------
// iterate command
// ---------------------------------------------------------------------------

export interface IterateOutput extends CLIJsonOutput {
  taskId: number;
  taskTitle: string;
  iterationNumber: number;
  expandedTitle?: string;
  expandedDescription?: string;
  instructions: string;
  worktreePath?: string;
  iterationPath?: string;
}

// ---------------------------------------------------------------------------
// delete command
// ---------------------------------------------------------------------------

export interface TaskDeleteOutput extends CLIJsonOutputWithErrors {}

// ---------------------------------------------------------------------------
// inspect command (task)
// ---------------------------------------------------------------------------

export interface FileChangeStat {
  path: string;
  insertions: number;
  deletions: number;
}

export interface TaskInspectionOutput {
  success: boolean;
  agent?: string;
  baseCommit?: string;
  branchName: string;
  completedAt?: string;
  createdAt: string;
  description: string;
  error?: string;
  failedAt?: string;
  fileChanges?: FileChangeStat[];
  files?: string[];
  formattedStatus: string;
  id: number;
  iterationFiles?: string[];
  iterations: number;
  lastIterationAt?: string;
  sourceBranch?: string;
  startedAt?: string;
  status: SchemaTaskStatus;
  statusUpdated: boolean;
  summary?: string;
  taskDirectory: string;
  title: string;
  uuid: string;
  workflowName: string;
  worktreePath: string;
  agentModel?: string;
  agentDisplay?: string;
  source?: {
    type: 'github' | 'manual';
    id?: string;
    url?: string;
    title?: string;
    ref?: Record<string, unknown>;
  };
}

export interface RawFileOutput {
  success: boolean;
  files: Array<{ filename: string; content: string }>;
  error?: string;
}

// ---------------------------------------------------------------------------
// info command
// ---------------------------------------------------------------------------

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  taskCount: number;
}

export interface InfoCommandOutput extends CLIJsonOutput {
  storePath: string;
  projectCount: number;
  projects: ProjectInfo[];
}

// ---------------------------------------------------------------------------
// diff command
// ---------------------------------------------------------------------------

export interface TaskDiffFileItem {
  path: string;
  insertions: number;
  deletions: number;
}

export interface TaskDiffOutput extends CLIJsonOutput {
  taskId: number;
  title: string;
  branchName: string;
  worktreePath: string;
  compareRef: string | null;
  files?: TaskDiffFileItem[];
  diff?: string;
}

// ---------------------------------------------------------------------------
// workflows list command
// ---------------------------------------------------------------------------

export interface WorkflowWithSource extends Workflow {
  source: WorkflowSource;
}

export interface ListWorkflowsOutput extends CLIJsonOutput {
  workflows: WorkflowWithSource[];
}

// ---------------------------------------------------------------------------
// workflows add command
// ---------------------------------------------------------------------------

export interface AddWorkflowOutput extends CLIJsonOutput {
  workflow?: {
    name: string;
    path: string;
    store: 'local' | 'global';
  };
}

// ---------------------------------------------------------------------------
// workflows inspect command
// ---------------------------------------------------------------------------

export interface InspectWorkflowOutput extends CLIJsonOutput {
  workflow?: Workflow;
  source?: string;
}
