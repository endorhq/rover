/**
 * Project configuration manager
 * Handles loading, saving, and managing rover.json files
 */

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  ProjectConfigLoadError,
  ProjectConfigValidationError,
  ProjectConfigSaveError,
  ProjectConfigSchema,
  CURRENT_PROJECT_SCHEMA_VERSION,
  PROJECT_CONFIG_FILENAME,
  type ProjectConfig,
  type Language,
  type MCP,
  type PackageManager,
  type TaskManager,
  type HooksConfig,
  type NetworkConfig,
} from 'rover-schemas';
import { GlobalConfigManager } from './global-config.js';

/**
 * Manager class for project configuration (rover.json)
 * @legacy
 */
export class ProjectConfigManager {
  constructor(
    private data: ProjectConfig,
    public projectRoot: string
  ) {}

  /**
   * Load project configuration.
   *
   * When `rover.json` exists on disk, it is loaded and validated (current behaviour).
   * When it does not exist, the project's `GlobalProject` entry is looked up and its
   * `languages`, `packageManagers`, and `taskManagers` are used as defaults so that
   * callers always receive a valid `ProjectConfigManager`.
   *
   * @param projectPath - The project root path where rover.json may be located
   */
  static load(projectPath: string): ProjectConfigManager {
    const projectRoot = projectPath;

    if (ProjectConfigManager.exists(projectRoot)) {
      return ProjectConfigManager.loadFromDisk(projectRoot);
    }

    // Infer defaults from the GlobalProject entry
    return ProjectConfigManager.inferFromGlobalProject(projectRoot);
  }

  /**
   * Load an existing configuration from disk.
   */
  private static loadFromDisk(projectRoot: string): ProjectConfigManager {
    const filePath = join(projectRoot, PROJECT_CONFIG_FILENAME);

    try {
      const rawData = readFileSync(filePath, 'utf8');
      const parsedData = JSON.parse(rawData);

      // Migrate if necessary
      const migratedData = ProjectConfigManager.migrate(parsedData);

      // Validate with Zod
      const validatedData = ProjectConfigSchema.parse(migratedData);
      const instance = new ProjectConfigManager(validatedData, projectRoot);

      // If migration occurred, save the updated data
      if (migratedData.version !== parsedData.version) {
        instance.save();
      }

      return instance;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ProjectConfigLoadError(
          `Invalid JSON format in ${filePath}`,
          error
        );
      } else if (error instanceof Error && 'issues' in error) {
        throw new ProjectConfigValidationError(
          `Validation failed for ${filePath}`,
          error as any
        );
      } else {
        throw new ProjectConfigLoadError(
          'Failed to load the project configuration.',
          error
        );
      }
    }
  }

  /**
   * Infer project configuration from the GlobalProject entry.
   * Uses the project's languages, packageManagers, and taskManagers as defaults.
   * Falls back to empty arrays if no GlobalProject entry is found.
   */
  private static inferFromGlobalProject(
    projectRoot: string
  ): ProjectConfigManager {
    let languages: Language[] = [];
    let packageManagers: PackageManager[] = [];
    let taskManagers: TaskManager[] = [];

    try {
      const globalConfig = GlobalConfigManager.load();
      const globalProject = globalConfig.getProjectByPath(projectRoot);
      if (globalProject) {
        languages = globalProject.languages as Language[];
        packageManagers = globalProject.packageManagers as PackageManager[];
        taskManagers = globalProject.taskManagers as TaskManager[];
      }
    } catch {
      // If global config can't be loaded, fall back to empty defaults
    }

    const schema: ProjectConfig = {
      version: CURRENT_PROJECT_SCHEMA_VERSION,
      languages,
      mcps: [],
      packageManagers,
      taskManagers,
      attribution: true,
    };

    return new ProjectConfigManager(schema, projectRoot);
  }

  /**
   * Create a new project configuration with defaults
   * @param projectPath - The project root path where rover.json will be created
   */
  static create(projectPath: string): ProjectConfigManager {
    const schema: ProjectConfig = {
      version: CURRENT_PROJECT_SCHEMA_VERSION,
      languages: [],
      mcps: [],
      packageManagers: [],
      taskManagers: [],
      attribution: true,
    };
    const projectRoot = projectPath;

    const instance = new ProjectConfigManager(schema, projectRoot);
    instance.save();
    return instance;
  }

  /**
   * Check if a project configuration exists
   * @param projectPath - The project root path to check
   */
  static exists(projectPath: string): boolean {
    const filePath = join(projectPath, PROJECT_CONFIG_FILENAME);
    return existsSync(filePath);
  }

  /**
   * Migrate old configuration to current schema version
   */
  private static migrate(data: any): ProjectConfig {
    // If already current version, return as-is
    if (data.version === CURRENT_PROJECT_SCHEMA_VERSION) {
      return data as ProjectConfig;
    }

    // Prepare sandbox object for v1.2
    let sandbox: { agentImage?: string; initScript?: string } | undefined;

    // Check if agentImage or initScript exist at the top level (from v1.0/v1.1)
    if (data.agentImage !== undefined || data.initScript !== undefined) {
      sandbox = {
        ...(data.agentImage !== undefined
          ? { agentImage: data.agentImage }
          : {}),
        ...(data.initScript !== undefined
          ? { initScript: data.initScript }
          : {}),
      };
    } else if (data.sandbox !== undefined) {
      // If sandbox already exists, preserve it
      sandbox = data.sandbox;
    }

    // For now, just ensure all required fields exist
    const migrated: ProjectConfig = {
      version: CURRENT_PROJECT_SCHEMA_VERSION,
      languages: data.languages || [],
      mcps: data.mcps || [],
      packageManagers: data.packageManagers || [],
      taskManagers: data.taskManagers || [],
      attribution: data.attribution !== undefined ? data.attribution : true,
      ...(data.envs !== undefined ? { envs: data.envs } : {}),
      ...(data.envsFile !== undefined ? { envsFile: data.envsFile } : {}),
      ...(sandbox !== undefined ? { sandbox } : {}),
      ...(data.hooks !== undefined ? { hooks: data.hooks } : {}),
      ...(data.excludePatterns !== undefined
        ? { excludePatterns: data.excludePatterns }
        : {}),
    };

    return migrated;
  }

  /**
   * Save current configuration to disk
   */
  save(): void {
    const filePath = join(this.projectRoot, PROJECT_CONFIG_FILENAME);
    try {
      const json = JSON.stringify(this.data, null, 2);
      writeFileSync(filePath, json, 'utf8');
    } catch (error) {
      throw new ProjectConfigSaveError(
        `Failed to save project configuration: ${error}`,
        error
      );
    }
  }

  /**
   * Reload configuration from disk
   */
  reload(): void {
    const reloaded = ProjectConfigManager.loadFromDisk(this.projectRoot);
    this.data = reloaded.data;
  }

  // Data Access (Getters)
  get version(): string {
    return this.data.version;
  }
  get languages(): Language[] {
    return this.data.languages;
  }
  get mcps(): MCP[] {
    return this.data.mcps;
  }
  get packageManagers(): PackageManager[] {
    return this.data.packageManagers;
  }
  get taskManagers(): TaskManager[] {
    return this.data.taskManagers;
  }
  get attribution(): boolean {
    return this.data.attribution;
  }
  get envs(): string[] | undefined {
    return this.data.envs;
  }
  get envsFile(): string | undefined {
    return this.data.envsFile;
  }
  get agentImage(): string | undefined {
    return this.data.sandbox?.agentImage;
  }
  get initScript(): string | undefined {
    return this.data.sandbox?.initScript;
  }
  get sandboxExtraArgs(): string | string[] | undefined {
    return this.data.sandbox?.extraArgs;
  }
  get hooks(): HooksConfig | undefined {
    return this.data.hooks;
  }
  get network(): NetworkConfig | undefined {
    return this.data.sandbox?.network;
  }
  get cacheFiles(): string[] | undefined {
    return this.data.sandbox?.cacheFiles;
  }
  get excludePatterns(): string[] | undefined {
    return this.data.excludePatterns;
  }

  // Data Modification (Setters)
  addLanguage(language: Language): void {
    if (!this.data.languages.includes(language)) {
      this.data.languages.push(language);
      this.save();
    }
  }

  removeLanguage(language: Language): void {
    const index = this.data.languages.indexOf(language);
    if (index > -1) {
      this.data.languages.splice(index, 1);
      this.save();
    }
  }

  addMCP(mcp: MCP): void {
    if (!this.data.mcps.some(m => m.name === mcp.name)) {
      this.data.mcps.push(mcp);
      this.save();
    }
  }

  removeMCP(mcp: MCP): void {
    const index = this.data.mcps.findIndex(m => m.name === mcp.name);
    if (index > -1) {
      this.data.mcps.splice(index, 1);
      this.save();
    }
  }

  addPackageManager(packageManager: PackageManager): void {
    if (!this.data.packageManagers.includes(packageManager)) {
      this.data.packageManagers.push(packageManager);
      this.save();
    }
  }

  removePackageManager(packageManager: PackageManager): void {
    const index = this.data.packageManagers.indexOf(packageManager);
    if (index > -1) {
      this.data.packageManagers.splice(index, 1);
      this.save();
    }
  }

  addTaskManager(taskManager: TaskManager): void {
    if (!this.data.taskManagers.includes(taskManager)) {
      this.data.taskManagers.push(taskManager);
      this.save();
    }
  }

  removeTaskManager(taskManager: TaskManager): void {
    const index = this.data.taskManagers.indexOf(taskManager);
    if (index > -1) {
      this.data.taskManagers.splice(index, 1);
      this.save();
    }
  }

  setAttribution(value: boolean): void {
    this.data.attribution = value;
    this.save();
  }

  /**
   * Get raw JSON data
   */
  toJSON(): ProjectConfig {
    return { ...this.data };
  }
}
