import { isAbsolute, join, resolve } from 'node:path';
import { getDataDir } from '../paths.js';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { GlobalProject } from 'rover-schemas';
import { createHash } from 'node:crypto';
import { detectEnvironment } from './environment.js';
import { GlobalConfigManager } from '../files/global-config.js';

// Folder inside the rover data store
const PROJECTS_DATA_FOLDER = 'projects';

/**
 * Error class for project configuration loading errors
 */
export class ProjectManagerLoadError extends Error {
  constructor(
    message: string,
    public readonly reason?: unknown
  ) {
    super(message);
    this.name = 'ProjectManagerLoadError';
  }
}

/**
 * Error class for project registration loading errors
 */
export class ProjectManagerRegistrationError extends Error {
  constructor(
    message: string,
    public readonly reason?: unknown
  ) {
    super(message);
    this.name = 'ProjectManagerRegistrationError';
  }
}

/**
 * The project manager class read, registers and manages projects in Rover.
 * It ensures the the folder structure is present and loads the information from
 * the central store.
 */
export class ProjectManager {
  private projectsPath: string;
  private config: GlobalConfigManager;

  /**
   * Initialize the manager class and ensure the required
   * folders are available.
   *
   * @throws {Error} If the required folders cannot be created or config cannot be loaded
   */
  constructor() {
    this.projectsPath = join(getDataDir(), PROJECTS_DATA_FOLDER);

    if (!existsSync(this.projectsPath)) {
      mkdirSync(this.projectsPath, { recursive: true });
    }

    // Load the configuration
    try {
      this.config = GlobalConfigManager.load();
    } catch (error) {
      throw new ProjectManagerLoadError(
        `Failed to load global configuration`,
        error
      );
    }
  }

  /**
   * Return the list of registered projects
   */
  list(): GlobalProject[] {
    return this.config.projects;
  }

  /**
   * Register a new project in the Rover system
   *
   * @param name The name of the project
   * @param path The filesystem path to the project
   * @param autodetect Identify languages, package managers and other tools automatically
   *
   * @throws {ProjectManagerRegistrationError} If the project cannot be registered
   */
  async add(
    name: string,
    path: string,
    autodetect: boolean = true
  ): Promise<void> {
    const id = this.generateProjectID(name, path);
    const realPath = isAbsolute(path) ? path : resolve(path);

    const project: GlobalProject = {
      id,
      path: realPath,
      repositoryName: name,
      languages: [],
      packageManagers: [],
      taskManagers: [],
    };

    if (autodetect) {
      // Identify project properties automatically
      try {
        const result = await detectEnvironment(realPath);

        project.languages = result.languages;
        project.packageManagers = result.packageManagers;
        project.taskManagers = result.taskManagers;
      } catch (error) {
        throw new ProjectManagerRegistrationError(
          `Could not autodetect the project environment when registering it`,
          error
        );
      }
    }

    try {
      this.createProjectFolders(id);
    } catch (error) {
      throw new ProjectManagerRegistrationError(
        `Could not create the project folders in the Rover store`,
        error
      );
    }

    this.config.addProject(project);
    return;
  }

  /**
   * Retrieve a registered project by its ID
   *
   * @param id The ID of the project to retrieve
   * @returns The registered project
   * @throws When the project is not found
   */
  get(id: string): GlobalProject {
    const project = this.config.projects.find(proj => proj.id === id);

    if (!project) {
      throw new ProjectManagerLoadError(`Project with ID ${id} not found`);
    }

    return project;
  }

  /**
   * Unregister a project from the Rover system
   *
   * @param id The ID of the project to unregister
   * @throws When the project files cannot be deleted
   */
  async remove(id: string): Promise<void> {
    this.deleteProjectFolders(id);
    this.config.removeProject(id);
  }

  /**
   * Retrieve the task directory of the given project
   *
   * @param id The ID of the project
   * @returns The path to the task directory
   */
  getProjectTasksPath(id: string): string {
    return join(this.projectsPath, id, 'tasks');
  }

  /**
   * Retrieve the workspaces directory of the given project
   *
   * @param id The ID of the project
   * @returns The path to the workspaces directory
   */
  getProjectWorkspacesPath(id: string): string {
    return join(this.projectsPath, id, 'workspaces');
  }

  /**
   * Retrieve the logs directory of the given project
   *
   * @param id The ID of the project
   * @returns The path to the logs directory
   */
  getProjectLogsPath(id: string): string {
    return join(this.projectsPath, id, 'logs');
  }

  /**
   * Create the folder structure for the project in the store.
   *
   * @throws When the folder cannot be created
   */
  private createProjectFolders(id: string) {
    const paths = [
      join(this.projectsPath, id, 'tasks'),
      join(this.projectsPath, id, 'workspaces'),
      join(this.projectsPath, id, 'logs'),
    ];

    for (const path in paths) {
      if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
      }
    }
  }

  /**
   * Delete the folder structure for the project in the store.
   *
   * @throws When the folder cannot be deleted
   */
  private deleteProjectFolders(id: string) {
    if (!existsSync(join(this.projectsPath, id))) {
      return;
    }

    rmSync(join(this.projectsPath, id), { recursive: true });
  }

  /**
   * Generate an ID to the project based on the current name and path. The format
   * will be the name-SHA256(path).slice(0, 8). This makes the project easier
   * to identify, while reducing potential collisions.
   */
  private generateProjectID(name: string, path: string) {
    // Replace invalid filename characters with -
    // Invalid on Windows: \ / : * ? " < > |
    // Invalid on Unix: / and null
    const cleanName = name.replace(/[\\/:*?"<>|]/g, '-');
    const hash = createHash('sha256').update(path).digest('hex').slice(0, 8);

    return `${cleanName}-${hash}`;
  }
}
