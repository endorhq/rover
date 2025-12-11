/**
 * TaskDescriptionManager class - Centralized management of task metadata
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { findProjectRoot, VERBOSE } from 'rover-core';
import {
  TaskDescriptionSchema,
  CreateTaskData,
  StatusMetadata,
  IterationMetadata,
  TaskStatus,
} from './task-description/types.js';
import {
  TaskNotFoundError,
  TaskValidationError,
  TaskSchemaError,
  TaskFileError,
} from './task-description/errors.js';
import {
  CURRENT_TASK_DESCRIPTION_SCHEMA_VERSION,
  TaskDescriptionSchema as TaskDescriptionZodSchema,
} from './task-description/schema.js';
import { IterationManager } from './iteration.js';

/**
 * TaskDescriptionManager class - Centralized management of task metadata
 */
export class TaskDescriptionManager {
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
  static create(taskData: CreateTaskData): TaskDescriptionManager {
    const now = new Date().toISOString();
    const uuid = taskData.uuid || randomUUID();

    const schema: TaskDescriptionSchema = {
      id: taskData.id,
      uuid: uuid,
      title: taskData.title,
      description: taskData.description,
      inputs: Object.fromEntries(taskData.inputs),
      status: 'NEW',
      createdAt: now,
      startedAt: now,
      lastIterationAt: now,
      iterations: 1,
      worktreePath: '',
      workflowName: taskData.workflowName,
      branchName: '',
      agent: taskData.agent,
      sourceBranch: taskData.sourceBranch,
      version: CURRENT_TASK_DESCRIPTION_SCHEMA_VERSION,
    };

    const instance = new TaskDescriptionManager(schema, taskData.id);

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
  static load(taskId: number): TaskDescriptionManager {
    const filePath = TaskDescriptionManager.getTaskDescriptionPath(taskId);

    if (!existsSync(filePath)) {
      throw new TaskNotFoundError(taskId);
    }

    try {
      const rawData = readFileSync(filePath, 'utf8');
      const parsedData = JSON.parse(rawData);

      // Migrate if necessary
      const migratedData = TaskDescriptionManager.migrate(parsedData, taskId);

      const instance = new TaskDescriptionManager(migratedData, taskId);

      // If migration occurred, save the updated data
      if (migratedData.version !== parsedData.version) {
        TaskDescriptionManager.createBackup(filePath);
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
    const filePath = TaskDescriptionManager.getTaskDescriptionPath(taskId);
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
    if (data.version === CURRENT_TASK_DESCRIPTION_SCHEMA_VERSION) {
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
    migrated.inputs = data.inputs || {};
    migrated.workflowName = data.workflowName || 'swe';
    migrated.status =
      TaskDescriptionManager.migrateStatus(data.status) || 'NEW';
    migrated.createdAt = data.createdAt || new Date().toISOString();
    migrated.iterations = data.iterations || 1;
    migrated.worktreePath = data.worktreePath || '';
    migrated.branchName = data.branchName || '';
    migrated.version = CURRENT_TASK_DESCRIPTION_SCHEMA_VERSION;

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

    // Preserve agentImage field
    migrated.agentImage = data.agentImage;

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
    return TaskDescriptionManager.getTaskDescriptionPath(taskId);
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
    const reloaded = TaskDescriptionManager.load(this.taskId);
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

  /**
   * Load all iterations for this task
   * @returns Array of IterationManager instances, sorted by iteration number (descending)
   */
  getIterations(): IterationManager[] {
    const iterations: IterationManager[] = [];
    const iterationsPath = this.iterationsPath();

    if (existsSync(iterationsPath)) {
      try {
        const iterationsIds = readdirSync(iterationsPath, {
          withFileTypes: true,
        })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => parseInt(dirent.name, 10))
          .filter(num => !isNaN(num))
          .sort((a, b) => b - a); // Sort descending to get latest first

        iterationsIds.forEach(id => {
          try {
            iterations.push(
              IterationManager.load(join(iterationsPath, id.toString()))
            );
          } catch (err) {
            // For now, just logging
            if (VERBOSE) {
              console.error(
                `Error loading iteration ${id} for task ${this.taskId}: ${err}`
              );
            }
          }
        });
      } catch (err) {
        if (VERBOSE) {
          console.error(
            `Error retrieving iterations for task ${this.taskId}: ${err}`
          );
        }

        throw new Error('There was an error retrieving the task iterations');
      }
    }

    return iterations;
  }

  /**
   * Retrieve the latest iteration for this task
   * @returns The most recent IterationManager instance, or undefined if none exist
   */
  getLastIteration(): IterationManager | undefined {
    let taskIteration: IterationManager | undefined;
    const iterationsPath = this.iterationsPath();

    if (existsSync(iterationsPath)) {
      try {
        const iterationsIds = readdirSync(iterationsPath, {
          withFileTypes: true,
        })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => parseInt(dirent.name, 10))
          .filter(num => !isNaN(num))
          .sort((a, b) => b - a); // Sort descending to get latest first

        if (iterationsIds.length > 0) {
          taskIteration = IterationManager.load(
            join(iterationsPath, iterationsIds[0].toString())
          );
        } else {
          if (VERBOSE) {
            console.error(`Did not find any iteration for task ${this.taskId}`);
          }
        }
      } catch (err) {
        if (VERBOSE) {
          console.error(
            `Error retrieving iterations for task ${this.taskId}: ${err}`
          );
        }

        throw new Error('There was an error retrieving the task iterations');
      }
    }

    return taskIteration;
  }

  /**
   * Update the task status based on the latest iteration
   */
  updateStatusFromIteration(): void {
    const iteration = this.getLastIteration();

    if (iteration != null) {
      const status = iteration.status();
      let statusName: TaskStatus;
      let timestamp;
      let error;

      switch (status.status) {
        case 'completed':
          statusName = status.status.toUpperCase() as TaskStatus;
          timestamp = status.completedAt;
          break;
        case 'failed':
          statusName = 'FAILED';
          timestamp = status.completedAt;
          error = status.error;
          break;
        case 'running':
          statusName = 'ITERATING';
          timestamp = status.updatedAt;
          break;
        default:
          statusName = 'IN_PROGRESS';
          timestamp = status.updatedAt;
          break;
      }

      // The merged / pushed status is already a completed state
      if (
        statusName === 'COMPLETED' &&
        ['MERGED', 'PUSHED'].includes(this.data.status)
      ) {
        return;
      }

      const metadata = { timestamp, error };
      this.setStatus(statusName, metadata);
    }
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

  // Other helpers
  iterationsPath(): string {
    return join(
      findProjectRoot(),
      '.rover',
      'tasks',
      this.taskId.toString(),
      'iterations'
    );
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
  get workflowName(): string {
    return this.data.workflowName;
  }
  get rawData(): TaskDescriptionSchema {
    return this.data;
  }
  get inputs(): Record<string, string> {
    return this.data.inputs;
  }
  get agentImage(): string | undefined {
    return this.data.agentImage;
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

  /**
   * Set agent image
   */
  setAgentImage(agentImage: string): void {
    this.data.agentImage = agentImage;
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

  /**
   * Validate the task data using Zod schema
   */
  private validate(): void {
    const result = TaskDescriptionZodSchema.safeParse(this.data);

    if (!result.success) {
      const errorMessages = result.error.issues
        .map(err => `  - ${err.path.join('.')}: ${err.message}`)
        .join('\n');
      throw new TaskValidationError(
        `Task validation failed:\n${errorMessages}`
      );
    }
  }
}
