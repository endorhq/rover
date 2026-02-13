import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CreateTaskData,
  GlobalProject,
  Language,
  PackageManager,
  TaskManager,
} from 'rover-schemas';
import type { GlobalConfigManager } from '../files/global-config.js';
import { TaskDescriptionManager } from '../files/task-description.js';
import { getProjectLogsDir } from '../paths.js';

/**
 * Manager for a single project. Provides access to project
 * data and paths for tasks, workspaces, and logs.
 *
 * ProjectManager is the single entry point for all task operations,
 * handling both central store and legacy (.rover/tasks) locations.
 */
export class ProjectManager {
  constructor(
    private project: GlobalProject,
    private readonly basePath: string,
    private readonly config: GlobalConfigManager
  ) {}

  // ============================================================
  // Project Identity
  // ============================================================

  /** Project unique identifier */
  get id(): string {
    return this.project.id;
  }

  /** Filesystem path to the project */
  get path(): string {
    return this.project.path;
  }

  /** Repository name */
  get name(): string {
    return this.project.repositoryName;
  }

  /** Detected programming languages */
  get languages(): Language[] {
    return this.project.languages;
  }

  /** Detected package managers */
  get packageManagers(): PackageManager[] {
    return this.project.packageManagers;
  }

  /** Detected task managers */
  get taskManagers(): TaskManager[] {
    return this.project.taskManagers;
  }

  // ============================================================
  // Project Persistence
  // ============================================================

  /**
   * Save project changes to the global configuration.
   * Used when updating project metadata (e.g., nextTaskId).
   */
  save(): void {
    this.config.updateProject(this.project);
  }

  // ============================================================
  // Task Operations
  // ============================================================

  /**
   * Get a task by ID.
   * Checks central store first, then falls back to legacy location.
   *
   * @param taskId - Task ID to retrieve
   * @returns TaskDescriptionManager or undefined if not found
   */
  getTask(taskId: number): TaskDescriptionManager | undefined {
    // Central store first (priority)
    const centralPath = this.getTaskPath(taskId);
    if (TaskDescriptionManager.exists(centralPath)) {
      return TaskDescriptionManager.load(centralPath, taskId);
    }

    // Legacy fallback (to be removed in future version)
    const legacyPath = this.getLegacyTaskPath(taskId);
    if (TaskDescriptionManager.exists(legacyPath)) {
      return TaskDescriptionManager.load(legacyPath, taskId);
    }

    return undefined;
  }

  /**
   * Create a new task in the central store.
   * Automatically generates a sequential task ID.
   *
   * @param data - Task creation data (without id - auto-assigned)
   * @returns TaskDescriptionManager for the new task
   */
  createTask(data: Omit<CreateTaskData, 'id'>): TaskDescriptionManager {
    const taskId = this.getNextTaskId();
    const taskPath = this.getTaskPath(taskId);
    return TaskDescriptionManager.create(taskPath, { ...data, id: taskId });
  }

  /**
   * List all tasks for this project.
   * Merges tasks from central store and legacy location.
   * Central store takes priority if same ID exists in both.
   *
   * @returns Array of TaskDescriptionManager instances, sorted by ID descending
   */
  listTasks(): TaskDescriptionManager[] {
    const tasks: TaskDescriptionManager[] = [];
    const seenIds = new Set<number>();

    // Central store tasks (priority)
    const centralTasks = this.listTasksFromPath(this.tasksPath);
    for (const task of centralTasks) {
      tasks.push(task);
      seenIds.add(task.id);
    }

    // Legacy tasks (if not already in central)
    const legacyTasks = this.listTasksFromPath(this.getLegacyTasksPath());
    for (const task of legacyTasks) {
      if (!seenIds.has(task.id)) {
        tasks.push(task);
      }
    }

    return tasks.sort((a, b) => b.id - a.id);
  }

  /**
   * Check if a task exists (in either central or legacy location).
   *
   * @param taskId - Task ID to check
   * @returns true if task exists
   */
  taskExists(taskId: number): boolean {
    return this.getTask(taskId) !== undefined;
  }

  /**
   * Delete a task from storage.
   * Checks central store first, then legacy location.
   *
   * @param task - TaskDescriptionManager to delete
   * @returns true if task was deleted, false if not found
   */
  deleteTask(task: TaskDescriptionManager): boolean {
    let deletedTask = false;

    // Check central store first
    const centralPath = this.getTaskPath(task.id);
    if (TaskDescriptionManager.exists(centralPath)) {
      rmSync(centralPath, { recursive: true });
      deletedTask = true;
    }

    // Legacy fallback (to be removed in future version)
    // @legacy
    const legacyPath = this.getLegacyTaskPath(task.id);
    if (TaskDescriptionManager.exists(legacyPath)) {
      rmSync(legacyPath, { recursive: true });
      deletedTask = true;
    }

    // Cleanup the workspace if it exists
    const workspacePath = task.worktreePath;
    if (existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true });
    }

    return deletedTask;
  }

  // ============================================================
  // Path Accessors
  // ============================================================

  /** Path to the project's tasks directory (central store) */
  get tasksPath(): string {
    return join(this.basePath, this.project.id, 'tasks');
  }

  /** Path to the project's workspaces directory */
  get workspacesPath(): string {
    return join(this.basePath, this.project.id, 'workspaces');
  }

  /** Path to the project's logs directory */
  get logsPath(): string {
    return getProjectLogsDir(join(this.basePath, this.project.id));
  }

  /**
   * Get path to a specific task directory (central store).
   *
   * @param taskId - Task ID
   * @returns Full path to the task directory
   */
  getTaskPath(taskId: number): string {
    return join(this.tasksPath, taskId.toString());
  }

  /**
   * Get path to a specific workspace directory.
   *
   * @param taskId - Task ID
   * @returns Full path to the workspace directory
   */
  getWorkspacePath(taskId: number): string {
    return join(this.workspacesPath, taskId.toString());
  }

  // ============================================================
  // Legacy Support (to be removed in future version)
  // ============================================================

  /**
   * Get path to a specific task in the legacy location.
   * @private
   */
  private getLegacyTaskPath(taskId: number): string {
    return join(this.project.path, '.rover', 'tasks', taskId.toString());
  }

  /**
   * Get path to the legacy tasks directory.
   * @private
   */
  private getLegacyTasksPath(): string {
    return join(this.project.path, '.rover', 'tasks');
  }

  // ============================================================
  // Helper Methods
  // ============================================================

  /**
   * Get and increment the next task ID for this project.
   * Task IDs are sequential per-project, stored in GlobalProject.nextTaskId.
   * @private
   */
  private getNextTaskId(): number {
    const id = this.project.nextTaskId ?? 1;
    this.project.nextTaskId = id + 1;
    this.save();
    return id;
  }

  /**
   * List tasks from a specific path.
   * @private
   */
  private listTasksFromPath(tasksPath: string): TaskDescriptionManager[] {
    const tasks: TaskDescriptionManager[] = [];

    if (!existsSync(tasksPath)) {
      return tasks;
    }

    try {
      const entries = readdirSync(tasksPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const taskId = parseInt(entry.name, 10);
        if (Number.isNaN(taskId)) continue;

        const taskPath = join(tasksPath, entry.name);
        if (TaskDescriptionManager.exists(taskPath)) {
          try {
            tasks.push(TaskDescriptionManager.load(taskPath, taskId));
          } catch {
            // Skip invalid tasks
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }

    return tasks;
  }

  /** Get the raw GlobalProject data */
  toJSON(): GlobalProject {
    return { ...this.project };
  }
}
