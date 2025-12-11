/**
 * Global configuration manager
 * Handles loading, saving, and managing the global config.json file
 */

import Telemetry, { TELEMETRY_FROM } from 'rover-telemetry';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { AI_AGENT, getConfigDir } from 'rover-core';
import {
  GlobalConfigLoadError,
  GlobalConfigValidationError,
  GlobalConfigSaveError,
} from './global-config/errors.js';
import {
  GlobalConfigSchema,
  CURRENT_GLOBAL_CONFIG_VERSION,
  GLOBAL_CONFIG_FILENAME,
} from './global-config/schema.js';
import type {
  AttributionStatus,
  GlobalConfig,
  GlobalProject,
  TelemetryStatus,
} from './global-config/types.js';

/**
 * Manager class for global configuration
 */
export class GlobalConfigManager {
  constructor(private data: GlobalConfig) {}

  /**
   * Load global configuration from disk
   */
  static load(): GlobalConfigManager {
    const filePath = GlobalConfigManager.getConfigPath();

    if (!existsSync(filePath)) {
      return GlobalConfigManager.createDefault();
    }

    try {
      const rawData = readFileSync(filePath, 'utf8');
      const parsedData = JSON.parse(rawData);

      // Migrate if necessary
      const migratedData = GlobalConfigManager.migrate(parsedData);

      // Validate with Zod
      const validatedData = GlobalConfigSchema.parse(migratedData);
      const instance = new GlobalConfigManager(validatedData);

      // If migration occurred, save the updated data
      if (migratedData.version !== parsedData.version) {
        instance.save();
      }

      return instance;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new GlobalConfigLoadError(
          `Invalid JSON format in ${filePath}`,
          error
        );
      } else if (error instanceof Error && 'issues' in error) {
        throw new GlobalConfigValidationError(
          `Validation failed for ${filePath}`,
          error as any
        );
      } else {
        throw new GlobalConfigLoadError(
          'Failed to load global configuration.',
          error
        );
      }
    }
  }

  /**
   * Create default global configuration
   */
  static createDefault(): GlobalConfigManager {
    const now = new Date().toISOString();

    // Try to read the existing information if possible
    // In the future, the telemetry will use these values.
    const telemetry = Telemetry.load(TELEMETRY_FROM.CLI);

    const schema: GlobalConfig = {
      version: CURRENT_GLOBAL_CONFIG_VERSION,
      agents: [],
      userId: telemetry.getUserId(),
      telemetry: telemetry.isDisabled() ? 'disabled' : 'enabled',
      attribution: 'unknown',
      createdAt: now,
      updatedAt: now,
      projects: [],
    };

    const instance = new GlobalConfigManager(schema);
    instance.save();
    return instance;
  }

  /**
   * Check if global configuration exists
   */
  static exists(): boolean {
    const filePath = GlobalConfigManager.getConfigPath();
    return existsSync(filePath);
  }

  /**
   * Get the path to the global configuration file
   */
  private static getConfigPath(): string {
    return join(getConfigDir(), GLOBAL_CONFIG_FILENAME);
  }

  /**
   * Migrate old configuration to current schema version
   */
  private static migrate(data: any): GlobalConfig {
    // If already current version, return as-is
    if (data.version === CURRENT_GLOBAL_CONFIG_VERSION) {
      return data as GlobalConfig;
    }

    // Future migrations will be added here
    // For now, return as-is since this is the first version
    return data as GlobalConfig;
  }

  /**
   * Save current configuration to disk
   */
  save(): void {
    const filePath = GlobalConfigManager.getConfigPath();
    const dirPath = getConfigDir();

    try {
      // Ensure config directory exists
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true, mode: 0o700 });
      }

      // Update the updatedAt timestamp
      this.data.updatedAt = new Date().toISOString();

      const json = JSON.stringify(this.data, null, 2);
      writeFileSync(filePath, json, 'utf8');
    } catch (error) {
      throw new GlobalConfigSaveError(
        `Failed to save global configuration: ${error}`,
        error
      );
    }
  }

  /**
   * Reload configuration from disk
   */
  reload(): void {
    const reloaded = GlobalConfigManager.load();
    this.data = reloaded.data;
  }

  // Data Access (Getters)
  get version(): string {
    return this.data.version;
  }

  get agents(): string[] {
    return this.data.agents;
  }

  get userId(): string {
    return this.data.userId;
  }

  get telemetry(): TelemetryStatus {
    return this.data.telemetry;
  }

  get attribution(): AttributionStatus {
    return this.data.attribution;
  }

  get createdAt(): string {
    return this.data.createdAt;
  }

  get updatedAt(): string {
    return this.data.updatedAt;
  }

  get projects(): GlobalProject[] {
    return this.data.projects;
  }

  // Data Modification (Setters)

  /**
   * Set the agents list (sorted by preference)
   */
  setAgents(agents: AI_AGENT[]): void {
    this.data.agents = agents;
    this.save();
  }

  /**
   * Set telemetry status
   */
  setTelemetry(status: TelemetryStatus): void {
    this.data.telemetry = status;
    this.save();
  }

  /**
   * Set attribution preference
   */
  setAttribution(status: AttributionStatus): void {
    this.data.attribution = status;
    this.save();
  }

  /**
   * Check if the attribution is enabled
   */
  isAttributionEnabled(): boolean {
    return this.data.attribution === 'enabled';
  }

  /**
   * Add a project to the configuration
   */
  addProject(project: GlobalProject): void {
    // Check if project already exists by id
    const existingIndex = this.data.projects.findIndex(
      p => p.id === project.id
    );
    if (existingIndex >= 0) {
      // Update existing project
      this.data.projects[existingIndex] = project;
    } else {
      this.data.projects.push(project);
    }
    this.save();
  }

  /**
   * Remove a project from the configuration
   */
  removeProject(projectId: string): void {
    const index = this.data.projects.findIndex(p => p.id === projectId);
    if (index > -1) {
      this.data.projects.splice(index, 1);
      this.save();
    }
  }

  /**
   * Get a project by ID
   */
  getProject(projectId: string): GlobalProject | undefined {
    return this.data.projects.find(p => p.id === projectId);
  }

  /**
   * Get a project by path
   */
  getProjectByPath(path: string): GlobalProject | undefined {
    return this.data.projects.find(p => p.path === path);
  }

  /**
   * Get raw JSON data
   */
  toJSON(): GlobalConfig {
    return structuredClone(this.data);
  }
}
