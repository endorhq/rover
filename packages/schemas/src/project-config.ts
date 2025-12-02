/**
 * Project configuration manager
 * Handles loading, saving, and managing rover.json files
 */

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { findProjectRoot } from 'rover-common';
import {
  ProjectConfigLoadError,
  ProjectConfigValidationError,
  ProjectConfigSaveError,
} from './project-config/errors.js';
import {
  ProjectConfigSchema,
  CURRENT_PROJECT_SCHEMA_VERSION,
  PROJECT_CONFIG_FILENAME,
} from './project-config/schema.js';
import type {
  ProjectConfig,
  Language,
  MCP,
  PackageManager,
  TaskManager,
} from './project-config/types.js';

/**
 * Manager class for project configuration (rover.json)
 */
export class ProjectConfigManager {
  constructor(
    private data: ProjectConfig,
    public projectRoot: string
  ) {}

  /**
   * Load an existing configuration from disk
   */
  static load(): ProjectConfigManager {
    const projectRoot = findProjectRoot();
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
   * Create a new project configuration with defaults
   */
  static create(): ProjectConfigManager {
    const schema: ProjectConfig = {
      version: CURRENT_PROJECT_SCHEMA_VERSION,
      languages: [],
      mcps: [],
      packageManagers: [],
      taskManagers: [],
      attribution: true,
    };
    const projectRoot = findProjectRoot();

    const instance = new ProjectConfigManager(schema, projectRoot);
    instance.save();
    return instance;
  }

  /**
   * Check if a project configuration exists
   */
  static exists(): boolean {
    const projectRoot = findProjectRoot();
    const filePath = join(projectRoot, PROJECT_CONFIG_FILENAME);
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
    const reloaded = ProjectConfigManager.load();
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
