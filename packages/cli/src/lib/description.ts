import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { findProjectRoot } from 'rover-common';

// Schema version for migrations
const CURRENT_SCHEMA_VERSION = '1.0';

// Status enum with additional status types
export type TaskStatus =
  | 'NEW'
  | 'IN_PROGRESS'
  | 'ITERATING'
  | 'COMPLETED'
  | 'FAILED'
  | 'MERGED'
  | 'PUSHED';

// Complete unified schema
export interface TaskDescriptionSchema {
  // Core Identity
  id: number; // Task ID (matches folder name)
  uuid: string; // Unique identifier
  title: string;
  description: string;

  // Status & Lifecycle
  status: TaskStatus;
  createdAt: string; // ISO datetime
  startedAt?: string; // ISO datetime
  completedAt?: string; // ISO datetime
  failedAt?: string; // ISO datetime
  lastIterationAt?: string; // ISO datetime
  lastStatusCheck?: string; // ISO datetime

  // Execution Context
  iterations: number; // Default: 1
  worktreePath: string; // Path to git worktree
  branchName: string; // Git branch name
  agent?: string; // AI agent used for execution (claude, gemini, qwen)
  sourceBranch?: string; // Source branch task was created from

  // Docker Execution
  containerId?: string; // Docker container ID
  executionStatus?: string; // Execution status (running, completed, failed, error)
  runningAt?: string; // ISO datetime when execution started
  errorAt?: string; // ISO datetime when error occurred
  exitCode?: number; // Process exit code

  // Error Handling
  error?: string; // Error message if failed

  // Restart Tracking
  restartCount?: number; // Number of times task has been restarted
  lastRestartAt?: string; // ISO datetime of last restart

  // Metadata
  version: string; // Schema version for migrations
}

// Data required to create a new task
export interface CreateTaskData {
  id: number;
  title: string;
  description: string;
  uuid?: string; // Optional, will be generated if not provided
  agent?: string; // AI agent to use for execution
  sourceBranch?: string; // Source branch task was created from
}

// Metadata for status updates
export interface StatusMetadata {
  timestamp?: string;
  error?: string;
}

// Metadata for iteration updates
export interface IterationMetadata {
  title?: string;
  description?: string;
  timestamp?: string;
}

// Custom exception classes
export class TaskNotFoundError extends Error {
  constructor(taskId: number) {
    super(`Task ${taskId} not found`);
    this.name = 'TaskNotFoundError';
  }
}

export class TaskValidationError extends Error {
  constructor(message: string) {
    super(`Task validation error: ${message}`);
    this.name = 'TaskValidationError';
  }
}

export class TaskSchemaError extends Error {
  constructor(message: string) {
    super(`Task schema error: ${message}`);
    this.name = 'TaskSchemaError';
  }
}

export class TaskFileError extends Error {
  constructor(message: string) {
    super(`Task file error: ${message}`);
    this.name = 'TaskFileError';
  }
}

/**
 * TaskDescription class - Centralized management of task metadata
 */
export class TaskDescription {
  private data: TaskDescriptionSchema;
  private taskId: number;
  private filePath: string;

  constructor(data: TaskDescriptionSchema, taskId: number) {
    this.data = data;
    this.taskId = taskId;
    this.filePath = this.getTaskDescriptionPath(taskId);
    this.validate();
  }

  // Static factory methods

  /**
   * Create a new task with initial metadata
   */
  static create(taskData: CreateTaskData): TaskDescription {
    const now = new Date().toISOString();
    const uuid = taskData.uuid || randomUUID();

    const schema: TaskDescriptionSchema = {
      id: taskData.id,
      uuid: uuid,
      title: taskData.title,
      description: taskData.description,
      status: 'NEW',
      createdAt: now,
      startedAt: now,
      lastIterationAt: now,
      iterations: 1,
      worktreePath: '',
      branchName: '',
      agent: taskData.agent,
      sourceBranch: taskData.sourceBranch,
      version: CURRENT_SCHEMA_VERSION,
    };

    const instance = new TaskDescription(schema, taskData.id);

    // Ensure task directory exists
    const taskDir = join(
      findProjectRoot(),
      '.rover',
      'tasks',
      taskData.id.toString()
    );
    mkdirSync(taskDir, { recursive: true });

    // Save the initial task
    instance.save();
    return instance;
  }

  /**
   * Load an existing task from disk
   */
  static load(taskId: number): TaskDescription {
    const filePath = TaskDescription.getTaskDescriptionPath(taskId);

    if (!existsSync(filePath)) {
      throw new TaskNotFoundError(taskId);
    }

    try {
      const rawData = readFileSync(filePath, 'utf8');
      const parsedData = JSON.parse(rawData);

      // Migrate if necessary
      const migratedData = TaskDescription.migrate(parsedData, taskId);

      const instance = new TaskDescription(migratedData, taskId);

      // If migration occurred, save the updated data
      if (migratedData.version !== parsedData.version) {
        TaskDescription.createBackup(filePath);
        instance.save();
      }

      return instance;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new TaskSchemaError(
          `Invalid JSON in task ${taskId}: ${error.message}`
        );
      }
      throw new TaskFileError(`Failed to load task ${taskId}: ${error}`);
    }
  }

  /**
   * Check if a task exists
   */
  static exists(taskId: number): boolean {
    const filePath = TaskDescription.getTaskDescriptionPath(taskId);
    return existsSync(filePath);
  }

  // Private static helper methods

  private static getTaskDescriptionPath(taskId: number): string {
    return join(
      findProjectRoot(),
      '.rover',
      'tasks',
      taskId.toString(),
      'description.json'
    );
  }

  private static createBackup(filePath: string): void {
    const backupPath = `${filePath}.backup`;
    try {
      copyFileSync(filePath, backupPath);
    } catch (error) {
      console.warn(`Failed to create backup for ${filePath}:`, error);
    }
  }

  private static migrate(data: any, taskId: number): TaskDescriptionSchema {
    // If already current version, return as-is
    if (data.version === CURRENT_SCHEMA_VERSION) {
      return data as TaskDescriptionSchema;
    }

    // Start with all existing data to preserve unknown fields
    const migrated: any = { ...data };

    // Apply required transformations and defaults
    migrated.id =
      typeof data.id === 'string' ? parseInt(data.id, 10) : data.id || taskId;
    migrated.uuid = data.uuid || randomUUID();
    migrated.title = data.title || 'Unknown Task';
    migrated.description = data.description || '';
    migrated.status = TaskDescription.migrateStatus(data.status) || 'NEW';
    migrated.createdAt = data.createdAt || new Date().toISOString();
    migrated.iterations = data.iterations || 1;
    migrated.worktreePath = data.worktreePath || '';
    migrated.branchName = data.branchName || '';
    migrated.version = CURRENT_SCHEMA_VERSION;

    // Preserve all execution-related fields
    migrated.containerId = data.containerId || '';
    migrated.executionStatus = data.executionStatus || '';
    migrated.runningAt = data.runningAt || '';
    migrated.errorAt = data.errorAt || '';
    migrated.exitCode = data.exitCode || 0;

    // Preserve optional datetime fields
    migrated.startedAt = data.startedAt || '';
    migrated.completedAt = data.completedAt || '';
    migrated.failedAt = data.failedAt || '';
    migrated.lastIterationAt = data.lastIterationAt || '';
    migrated.lastStatusCheck = data.lastStatusCheck || '';

    // Preserve error information
    migrated.error = data.error;

    // Preserve restart tracking information
    migrated.restartCount = data.restartCount || 0;
    migrated.lastRestartAt = data.lastRestartAt || '';

    // Preserve agent and sourceBranch fields
    migrated.agent = data.agent;
    migrated.sourceBranch = data.sourceBranch;

    return migrated as TaskDescriptionSchema;
  }

  private static migrateStatus(oldStatus: any): TaskStatus {
    if (typeof oldStatus !== 'string') return 'NEW';

    // Map old status values to new enum
    switch (oldStatus.toLowerCase()) {
      case 'new':
        return 'NEW';
      case 'in_progress':
      case 'running':
        return 'IN_PROGRESS';
      case 'iterating':
        return 'ITERATING';
      case 'completed':
        return 'COMPLETED';
      case 'failed':
        return 'FAILED';
      case 'merged':
        return 'MERGED';
      case 'pushed':
        return 'PUSHED';
      default:
        return 'NEW';
    }
  }

  private getTaskDescriptionPath(taskId: number): string {
    return TaskDescription.getTaskDescriptionPath(taskId);
  }

  // CRUD Operations

  /**
   * Save current data to disk
   */
  save(): void {
    try {
      this.validate();
      const json = JSON.stringify(this.data, null, 2);
      writeFileSync(this.filePath, json, 'utf8');
    } catch (error) {
      throw new TaskFileError(`Failed to save task ${this.taskId}: ${error}`);
    }
  }

  /**
   * Reload data from disk
   */
  reload(): void {
    const reloaded = TaskDescription.load(this.taskId);
    this.data = reloaded.data;
  }

  /**
   * Delete the task file
   */
  delete(): void {
    try {
      if (existsSync(this.filePath)) {
        rmSync(this.filePath);
      }
    } catch (error) {
      throw new TaskFileError(`Failed to delete task ${this.taskId}: ${error}`);
    }
  }

  // Status Management

  /**
   * Set task status with optional metadata
   */
  setStatus(status: TaskStatus, metadata?: StatusMetadata): void {
    this.data.status = status;

    const timestamp = metadata?.timestamp || new Date().toISOString();

    switch (status) {
      case 'IN_PROGRESS':
        if (!this.data.startedAt) {
          this.data.startedAt = timestamp;
        }
        break;
      case 'ITERATING':
        this.data.lastIterationAt = timestamp;
        break;
      case 'COMPLETED':
        this.data.completedAt = timestamp;
        break;
      case 'FAILED':
        this.data.failedAt = timestamp;
        if (metadata?.error) {
          this.data.error = metadata.error;
        }
        break;
      case 'MERGED':
      case 'PUSHED':
        // Mark as completed when merged or pushed
        if (!this.data.completedAt) {
          this.data.completedAt = timestamp;
        }
        break;
    }

    this.data.lastStatusCheck = timestamp;
    this.save();
  }

  /**
   * Mark task as completed
   */
  markCompleted(completedAt?: string): void {
    this.setStatus('COMPLETED', { timestamp: completedAt });
  }

  /**
   * Mark task as failed with error message
   */
  markFailed(error: string, failedAt?: string): void {
    this.setStatus('FAILED', { timestamp: failedAt, error });
  }

  /**
   * Mark task as in progress
   */
  markInProgress(startedAt?: string): void {
    this.setStatus('IN_PROGRESS', { timestamp: startedAt });
  }

  /**
   * Mark task as iterating
   */
  markIterating(timestamp?: string): void {
    this.setStatus('ITERATING', { timestamp });
  }

  /**
   * Mark task as merged
   */
  markMerged(timestamp?: string): void {
    this.setStatus('MERGED', { timestamp });
  }

  /**
   * Mark task as pushed
   */
  markPushed(timestamp?: string): void {
    this.setStatus('PUSHED', { timestamp });
  }

  /**
   * Reset task back to NEW status (for container start failures or user reset)
   */
  resetToNew(timestamp?: string): void {
    this.setStatus('NEW', { timestamp });
  }

  /**
   * Restart a failed task by resetting to IN_PROGRESS  status and tracking restart attempt
   */
  restart(timestamp?: string): void {
    const restartTimestamp = timestamp || new Date().toISOString();

    // Increment restart count
    this.data.restartCount = (this.data.restartCount || 0) + 1;
    this.data.lastRestartAt = restartTimestamp;

    // Reset to IN_PROGRESS status
    this.setStatus('IN_PROGRESS', { timestamp: restartTimestamp });
  }

  // Iteration Management

  /**
   * Increment iteration counter
   */
  incrementIteration(): void {
    this.data.iterations += 1;
    this.data.lastIterationAt = new Date().toISOString();
    this.save();
  }

  /**
   * Update iteration metadata
   */
  updateIteration(metadata: IterationMetadata): void {
    if (metadata.timestamp) {
      this.data.lastIterationAt = metadata.timestamp;
    }
    this.save();
  }

  // Workspace Management

  /**
   * Set workspace information
   */
  setWorkspace(worktreePath: string, branchName: string): void {
    this.data.worktreePath = worktreePath;
    this.data.branchName = branchName;
    this.save();
  }

  // Data Access (Getters)

  get id(): number {
    return this.data.id;
  }
  get uuid(): string {
    return this.data.uuid;
  }
  get title(): string {
    return this.data.title;
  }
  get description(): string {
    return this.data.description;
  }
  get status(): TaskStatus {
    return this.data.status;
  }
  get createdAt(): string {
    return this.data.createdAt;
  }
  get startedAt(): string | undefined {
    return this.data.startedAt;
  }
  get completedAt(): string | undefined {
    return this.data.completedAt;
  }
  get failedAt(): string | undefined {
    return this.data.failedAt;
  }
  get lastIterationAt(): string | undefined {
    return this.data.lastIterationAt;
  }
  get lastStatusCheck(): string | undefined {
    return this.data.lastStatusCheck;
  }
  get iterations(): number {
    return this.data.iterations;
  }
  get worktreePath(): string {
    return this.data.worktreePath;
  }
  get branchName(): string {
    return this.data.branchName;
  }
  get agent(): string | undefined {
    return this.data.agent;
  }
  get sourceBranch(): string | undefined {
    return this.data.sourceBranch;
  }
  get containerId(): string | undefined {
    return this.data.containerId;
  }
  get executionStatus(): string | undefined {
    return this.data.executionStatus;
  }
  get runningAt(): string | undefined {
    return this.data.runningAt;
  }
  get errorAt(): string | undefined {
    return this.data.errorAt;
  }
  get exitCode(): number | undefined {
    return this.data.exitCode;
  }
  get error(): string | undefined {
    return this.data.error;
  }
  get restartCount(): number | undefined {
    return this.data.restartCount;
  }
  get lastRestartAt(): string | undefined {
    return this.data.lastRestartAt;
  }
  get version(): string {
    return this.data.version;
  }

  // Data Modification (Setters)

  /**
   * Update task title
   */
  updateTitle(title: string): void {
    this.data.title = title;
    this.save();
  }

  /**
   * Update task description
   */
  updateDescription(description: string): void {
    this.data.description = description;
    this.save();
  }

  // Docker Execution Management

  /**
   * Set container execution information
   */
  setContainerInfo(containerId: string, executionStatus: string): void {
    this.data.containerId = containerId;
    this.data.executionStatus = executionStatus;
    if (executionStatus === 'running') {
      this.data.runningAt = new Date().toISOString();
    }
    this.save();
  }

  /**
   * Update execution status
   */
  updateExecutionStatus(
    status: string,
    metadata?: { exitCode?: number; error?: string }
  ): void {
    this.data.executionStatus = status;

    if (metadata?.exitCode !== undefined) {
      this.data.exitCode = metadata.exitCode;
    }

    if (metadata?.error) {
      this.data.error = metadata.error;
      this.data.errorAt = new Date().toISOString();
    }

    if (status === 'completed') {
      this.data.completedAt = new Date().toISOString();
    } else if (status === 'failed') {
      this.data.failedAt = new Date().toISOString();
    }

    this.save();
  }

  // Utility Methods

  /**
   * Get raw JSON data
   */
  toJSON(): TaskDescriptionSchema {
    return { ...this.data };
  }

  /**
   * Check if task is completed
   */
  isCompleted(): boolean {
    return this.data.status === 'COMPLETED';
  }

  /**
   * Check if task failed
   */
  isFailed(): boolean {
    return this.data.status === 'FAILED';
  }

  /**
   * Check if task is in progress
   */
  isInProgress(): boolean {
    return this.data.status === 'IN_PROGRESS';
  }

  /**
   * Check if task is iterating
   */
  isIterating(): boolean {
    return this.data.status === 'ITERATING';
  }

  /**
   * Check if task is new
   */
  isNew(): boolean {
    return this.data.status === 'NEW';
  }

  /**
   * Check if task is merged
   */
  isMerged(): boolean {
    return this.data.status === 'MERGED';
  }

  /**
   * Check if task is pushed
   */
  isPushed(): boolean {
    return this.data.status === 'PUSHED';
  }

  /**
   * Get task duration in milliseconds
   */
  getDuration(): number | null {
    if (!this.data.startedAt) return null;

    const endTime = this.data.completedAt || this.data.failedAt;
    if (!endTime) return null;

    const start = new Date(this.data.startedAt);
    const end = new Date(endTime);

    return end.getTime() - start.getTime();
  }

  // Validation

  private validate(): void {
    const errors: string[] = [];

    // Required fields
    if (!this.data.id) errors.push('id is required');
    if (!this.data.uuid) errors.push('uuid is required');
    if (!this.data.title) errors.push('title is required');
    if (!this.data.description) errors.push('description is required');
    if (!this.data.status) errors.push('status is required');
    if (!this.data.createdAt) errors.push('createdAt is required');

    // Type validation
    if (typeof this.data.id !== 'number') errors.push('id must be a number');
    if (typeof this.data.iterations !== 'number')
      errors.push('iterations must be a number');
    if (this.data.iterations < 1) errors.push('iterations must be at least 1');

    // Status enum validation
    const validStatuses: TaskStatus[] = [
      'NEW',
      'IN_PROGRESS',
      'ITERATING',
      'COMPLETED',
      'FAILED',
      'MERGED',
      'PUSHED',
    ];
    if (!validStatuses.includes(this.data.status)) {
      errors.push(`status must be one of: ${validStatuses.join(', ')}`);
    }

    // Date format validation (basic ISO check)
    const dateFields = [
      'createdAt',
      'startedAt',
      'completedAt',
      'failedAt',
      'lastIterationAt',
      'lastStatusCheck',
    ];
    for (const field of dateFields) {
      const value = this.data[field as keyof TaskDescriptionSchema];
      if (value && typeof value === 'string' && isNaN(Date.parse(value))) {
        errors.push(`${field} must be a valid ISO date string`);
      }
    }

    if (errors.length > 0) {
      throw new TaskValidationError(errors.join(', '));
    }
  }
}
