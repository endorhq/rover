/**
 * TaskDescriptionManager class - Centralized management of task metadata
 *
 * This class is path-agnostic: it receives the task's base path from the caller.
 * Path resolution is handled by ProjectManager, which knows about central and legacy locations.
 */
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  CURRENT_TASK_DESCRIPTION_SCHEMA_VERSION,
  TaskDescriptionSchema,
  TaskFileError,
  TaskNotFoundError,
  TaskSchemaError,
  TaskValidationError,
  type CreateTaskData,
  type IterationMetadata,
  type NetworkConfig,
  type StatusMetadata,
  type TaskDescription,
  type TaskStatus,
} from 'rover-schemas';
import { VERBOSE } from '../verbose.js';
import { IterationManager } from './iteration.js';

/**
 * TaskDescriptionManager class - Centralized management of task metadata
 */
export class TaskDescriptionManager {
  private data: TaskDescription;
  private taskId: number;
  private basePath: string;
  private filePath: string;

  constructor(data: TaskDescription, taskId: number, basePath: string) {
    this.data = data;
    this.taskId = taskId;
    this.basePath = basePath;
    this.filePath = join(basePath, 'description.json');
    this.validate();
  }

  // ============================================================
  // Static Factory Methods
  // ============================================================

  /**
   * Create a new task with initial metadata
   *
   * @param basePath - Base path for the task directory
   * @param taskData - Task creation data
   * @returns TaskDescriptionManager instance
   */
  static create(
    basePath: string,
    taskData: CreateTaskData
  ): TaskDescriptionManager {
    const now = new Date().toISOString();
    const uuid = taskData.uuid || randomUUID();

    const schema: TaskDescription = {
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
      agentModel: taskData.agentModel,
      sourceBranch: taskData.sourceBranch,
      networkConfig: taskData.networkConfig,
      source: taskData.source,
      version: CURRENT_TASK_DESCRIPTION_SCHEMA_VERSION,
    };

    // Ensure task directory exists
    mkdirSync(basePath, { recursive: true });

    const instance = new TaskDescriptionManager(schema, taskData.id, basePath);
    instance.save();
    return instance;
  }

  /**
   * Load an existing task from disk
   *
   * @param basePath - Base path for the task directory
   * @param taskId - Task ID
   * @returns TaskDescriptionManager instance
   * @throws TaskNotFoundError if task doesn't exist
   */
  static load(basePath: string, taskId: number): TaskDescriptionManager {
    const filePath = join(basePath, 'description.json');

    if (!existsSync(filePath)) {
      throw new TaskNotFoundError(taskId);
    }

    try {
      const rawData = readFileSync(filePath, 'utf8');
      const parsedData = JSON.parse(rawData);

      // Migrate if necessary
      const migratedData = TaskDescriptionManager.migrate(parsedData, taskId);

      const instance = new TaskDescriptionManager(
        migratedData,
        taskId,
        basePath
      );

      // If migration occurred, save the updated data
      if (migratedData.version !== parsedData.version) {
        TaskDescriptionManager.createBackup(filePath);
        instance.save();
      }

      return instance;
    } catch (error) {
      if (error instanceof TaskNotFoundError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new TaskSchemaError(
          `Invalid JSON in task ${taskId}: ${error.message}`
        );
      }
      throw new TaskFileError(`Failed to load task ${taskId}: ${error}`);
    }
  }

  /**
   * Check if a task exists at the given path
   *
   * @param basePath - Base path for the task directory
   * @returns true if task exists
   */
  static exists(basePath: string): boolean {
    const filePath = join(basePath, 'description.json');
    return existsSync(filePath);
  }

  // ============================================================
  // Private Static Helper Methods
  // ============================================================

  private static createBackup(filePath: string): void {
    const backupPath = `${filePath}.backup`;
    try {
      copyFileSync(filePath, backupPath);
    } catch (error) {
      console.warn(`Failed to create backup for ${filePath}:`, error);
    }
  }

  private static migrate(data: any, taskId: number): TaskDescription {
    // If already current version, return as-is
    if (data.version === CURRENT_TASK_DESCRIPTION_SCHEMA_VERSION) {
      return data as TaskDescription;
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
    migrated.runningAt = data.runningAt || undefined;
    migrated.errorAt = data.errorAt || undefined;
    migrated.exitCode = data.exitCode || 0;

    // Preserve optional datetime fields
    migrated.startedAt = data.startedAt || undefined;
    migrated.completedAt = data.completedAt || undefined;
    migrated.failedAt = data.failedAt || undefined;
    migrated.lastIterationAt = data.lastIterationAt || undefined;
    migrated.lastStatusCheck = data.lastStatusCheck || undefined;

    // Preserve error information
    migrated.error = data.error;

    // Preserve restart tracking information
    migrated.restartCount = data.restartCount || 0;
    migrated.lastRestartAt = data.lastRestartAt || undefined;

    // Preserve agent, agentModel, and sourceBranch fields
    migrated.agent = data.agent;
    migrated.agentModel = data.agentModel;
    migrated.sourceBranch = data.sourceBranch;

    // Preserve agentImage field
    migrated.agentImage = data.agentImage;

    // Preserve networkConfig field
    migrated.networkConfig = data.networkConfig;

    // Preserve baseCommit field
    migrated.baseCommit = data.baseCommit;

    // Preserve task source (and migrate from old githubIssue if present)
    if (data.source) {
      migrated.source = data.source;
    } else if (data.githubIssue) {
      // Migrate old githubIssue format to new source format
      migrated.source = {
        type: 'github',
        id: String(data.githubIssue.number),
        url: `https://github.com/${data.githubIssue.repository}/issues/${data.githubIssue.number}`,
        ref: {
          owner: data.githubIssue.repository.split('/')[0],
          repo: data.githubIssue.repository.split('/')[1],
          number: data.githubIssue.number,
        },
      };
    }

    return migrated as TaskDescription;
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

  // ============================================================
  // CRUD Operations
  // ============================================================

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
    const reloaded = TaskDescriptionManager.load(this.basePath, this.taskId);
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

  // ============================================================
  // Status Management
  // ============================================================

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

  // ============================================================
  // Iteration Management
  // ============================================================

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
          .filter(num => !Number.isNaN(num))
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
          .filter(num => !Number.isNaN(num))
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

  // ============================================================
  // Workspace Management
  // ============================================================

  /**
   * Set workspace information
   */
  setWorkspace(worktreePath: string, branchName: string): void {
    this.data.worktreePath = worktreePath;
    this.data.branchName = branchName;
    this.save();
  }

  // ============================================================
  // Path Helpers
  // ============================================================

  /**
   * Get path to this task's iterations directory
   */
  iterationsPath(): string {
    return join(this.basePath, 'iterations');
  }

  /**
   * Get path to the current iteration directory
   */
  getIterationPath(): string {
    return join(this.iterationsPath(), this.data.iterations.toString());
  }

  /**
   * Get the base path for this task
   */
  getBasePath(): string {
    return this.basePath;
  }

  // ============================================================
  // Data Access (Getters)
  // ============================================================

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
  get agentModel(): string | undefined {
    return this.data.agentModel;
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
  get rawData(): TaskDescription {
    return this.data;
  }
  get inputs(): Record<string, string> {
    return this.data.inputs;
  }
  get agentImage(): string | undefined {
    return this.data.agentImage;
  }
  get networkConfig(): NetworkConfig | undefined {
    return this.data.networkConfig;
  }
  get baseCommit(): string | undefined {
    return this.data.baseCommit;
  }
  get source(): TaskDescription['source'] {
    return this.data.source;
  }
  get onCompleteHookFiredForStatus(): TaskDescription['onCompleteHookFiredForStatus'] {
    return this.data.onCompleteHookFiredForStatus;
  }

  /**
   * Update task source metadata
   */
  updateSource(source: TaskDescription['source']): void {
    this.data.source = source;
    this.save();
  }

  // ============================================================
  // Data Modification (Setters)
  // ============================================================

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

  /**
   * Set the base commit hash (the commit when the worktree was created)
   */
  setBaseCommit(commit: string): void {
    this.data.baseCommit = commit;
    this.save();
  }

  /**
   * Record that the onComplete hook was fired for a specific status.
   * Used to prevent duplicate hook executions across process restarts.
   */
  setOnCompleteHookFiredForStatus(status: TaskStatus): void {
    this.data.onCompleteHookFiredForStatus = status;
    this.save();
  }

  // ============================================================
  // Docker Execution Management
  // ============================================================

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

  // ============================================================
  // Utility Methods
  // ============================================================

  /**
   * Get raw JSON data
   */
  toJSON(): TaskDescription {
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
   * Check if task is in an active state (NEW, IN_PROGRESS, or ITERATING)
   */
  isActive(): boolean {
    return this.isNew() || this.isInProgress() || this.isIterating();
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

  // ============================================================
  // Validation
  // ============================================================

  /**
   * Validate the task data using Zod schema
   */
  private validate(): void {
    const result = TaskDescriptionSchema.safeParse(this.data);

    if (!result.success) {
      throw new TaskValidationError(
        `Task validation failed: ${result.error.message}`
      );
    }
  }
}
