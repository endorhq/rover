import { join } from 'node:path';
import type {
  GlobalProject,
  Language,
  PackageManager,
  TaskManager,
} from 'rover-schemas';

/**
 * Manager for a single project. Provides access to project
 * data and paths for tasks, workspaces, and logs.
 */
export class ProjectManager {
  constructor(
    private readonly project: GlobalProject,
    private readonly basePath: string
  ) {}

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

  /** Path to the project's tasks directory */
  get tasksPath(): string {
    return join(this.basePath, this.project.id, 'tasks');
  }

  /** Path to the project's workspaces directory */
  get workspacesPath(): string {
    return join(this.basePath, this.project.id, 'workspaces');
  }

  /** Path to the project's logs directory */
  get logsPath(): string {
    return join(this.basePath, this.project.id, 'logs');
  }

  /** Get the raw GlobalProject data */
  toJSON(): GlobalProject {
    return { ...this.project };
  }
}
