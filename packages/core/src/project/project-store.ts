import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { GlobalProject } from 'rover-schemas';
import { GlobalConfigManager } from '../files/global-config.js';
import { getDataDir } from '../paths.js';
import { detectEnvironment } from './environment.js';
import { ProjectManager } from './project.js';

const PROJECTS_DATA_FOLDER = 'projects';

/**
 * Error thrown when project store fails to load
 */
export class ProjectStoreLoadError extends Error {
  constructor(
    message: string,
    public readonly reason?: unknown
  ) {
    super(message);
    this.name = 'ProjectStoreLoadError';
  }
}

/**
 * Error thrown when project registration fails
 */
export class ProjectStoreRegistrationError extends Error {
  constructor(
    message: string,
    public readonly reason?: unknown
  ) {
    super(message);
    this.name = 'ProjectStoreRegistrationError';
  }
}

export interface AddProjectOptions {
  /** Whether to autodetect languages and package managers */
  autodetect?: boolean;
  /** Initial Task ID */
  initialTaskId?: number;
}

/**
 * Store for managing multiple projects in Rover.
 * Handles loading, adding, listing, and removing projects.
 */
export class ProjectStore {
  private projectsPath: string;
  private config: GlobalConfigManager;

  constructor() {
    this.projectsPath = join(getDataDir(), PROJECTS_DATA_FOLDER);

    if (!existsSync(this.projectsPath)) {
      mkdirSync(this.projectsPath, { recursive: true });
    }

    try {
      this.config = GlobalConfigManager.load();
    } catch (error) {
      throw new ProjectStoreLoadError(
        'Failed to load global configuration',
        error
      );
    }
  }

  /**
   * List all registered projects
   */
  list(): GlobalProject[] {
    return this.config.projects;
  }

  /**
   * Register a new project in the Rover system
   *
   * @param name - Project name
   * @param path - Filesystem path to the project
   * @param autodetect - Detect languages, package managers automatically
   * @returns ProjectManager for the newly registered project
   */
  async add(
    name: string,
    path: string,
    options: AddProjectOptions = {}
  ): Promise<ProjectManager> {
    const id = this.generateProjectID(name, path);
    const realPath = isAbsolute(path) ? path : resolve(path);

    const project: GlobalProject = {
      id,
      path: realPath,
      repositoryName: name,
      languages: [],
      packageManagers: [],
      taskManagers: [],
      nextTaskId: options.initialTaskId ?? 1,
    };

    if (options.autodetect) {
      try {
        const result = await detectEnvironment(realPath);
        project.languages = result.languages;
        project.packageManagers = result.packageManagers;
        project.taskManagers = result.taskManagers;
      } catch (error) {
        throw new ProjectStoreRegistrationError(
          'Could not autodetect the project environment when registering it',
          error
        );
      }
    }

    try {
      this.createProjectFolders(id);
    } catch (error) {
      throw new ProjectStoreRegistrationError(
        'Could not create the project folders in the Rover store',
        error
      );
    }

    this.config.addProject(project);
    return new ProjectManager(project, this.projectsPath, this.config);
  }

  /**
   * Get a project by ID
   *
   * @param id - Project ID
   * @returns ProjectManager or undefined if not found
   */
  get(id: string): ProjectManager | undefined {
    const project = this.config.projects.find(p => p.id === id);
    if (!project) {
      return undefined;
    }
    return new ProjectManager(project, this.projectsPath, this.config);
  }

  /**
   * Get a project by filesystem path
   *
   * @param path - Filesystem path
   * @returns ProjectManager or undefined if not found
   */
  getByPath(path: string): ProjectManager | undefined {
    const realPath = isAbsolute(path) ? path : resolve(path);
    const project = this.config.getProjectByPath(realPath);
    if (!project) {
      return undefined;
    }
    return new ProjectManager(project, this.projectsPath, this.config);
  }

  /**
   * Remove a project from the Rover system
   *
   * @param id - Project ID to remove
   */
  remove(id: string): void {
    this.deleteProjectFolders(id);
    this.config.removeProject(id);
  }

  /**
   * Get the base path for all projects data
   */
  getProjectsPath(): string {
    return this.projectsPath;
  }

  private createProjectFolders(id: string): void {
    const paths = [
      join(this.projectsPath, id, 'tasks'),
      join(this.projectsPath, id, 'workspaces'),
      join(this.projectsPath, id, 'logs'),
    ];

    for (const p of paths) {
      if (!existsSync(p)) {
        mkdirSync(p, { recursive: true });
      }
    }
  }

  private deleteProjectFolders(id: string): void {
    const projectPath = join(this.projectsPath, id);
    if (!existsSync(projectPath)) {
      return;
    }
    rmSync(projectPath, { recursive: true });
  }

  /**
   * Generate project ID from name and path
   * Format: cleanName-SHA256(path).slice(0, 8)
   */
  private generateProjectID(name: string, path: string): string {
    // Replace invalid filename characters
    const cleanName = name.replace(/[\\/:*?"<>|]/g, '-');
    const hash = createHash('sha256').update(path).digest('hex').slice(0, 8);
    return `${cleanName}-${hash}`;
  }
}
