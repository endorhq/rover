/**
 * User settings manager
 * Handles loading, saving, and managing .rover/settings.json files
 */

import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { findProjectRoot, AI_AGENT } from 'rover-core';
import {
  UserSettingsLoadError,
  UserSettingsValidationError,
  UserSettingsSaveError,
} from './user-settings/errors.js';
import {
  UserSettingsSchema,
  CURRENT_USER_SCHEMA_VERSION,
  USER_SETTINGS_FILENAME,
  USER_SETTINGS_DIR,
} from './user-settings/schema.js';
import type { UserSettings } from './user-settings/types.js';

/**
 * Manager class for user settings (.rover/settings.json)
 */
export class UserSettingsManager {
  constructor(private data: UserSettings) {}

  /**
   * Load user settings from disk
   */
  static load(): UserSettingsManager {
    const filePath = UserSettingsManager.getSettingsPath();

    if (!existsSync(filePath)) {
      // Return default settings if file doesn't exist
      return UserSettingsManager.createDefault();
    }

    try {
      const rawData = readFileSync(filePath, 'utf8');
      const parsedData = JSON.parse(rawData);

      // Migrate if necessary
      const migratedData = UserSettingsManager.migrate(parsedData);

      // Validate with Zod
      const validatedData = UserSettingsSchema.parse(migratedData);
      const instance = new UserSettingsManager(validatedData);

      // If migration occurred, save the updated data
      if (migratedData.version !== parsedData.version) {
        instance.save();
      }

      return instance;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new UserSettingsLoadError(
          `Invalid JSON format in ${filePath}`,
          error
        );
      } else if (error instanceof Error && 'issues' in error) {
        throw new UserSettingsValidationError(
          `Validation failed for ${filePath}`,
          error as any
        );
      } else {
        throw new UserSettingsLoadError('Failed to load user settings.', error);
      }
    }
  }

  /**
   * Create default user settings
   */
  static createDefault(): UserSettingsManager {
    const schema: UserSettings = {
      version: CURRENT_USER_SCHEMA_VERSION,
      aiAgents: [],
      defaults: {},
    };

    const instance = new UserSettingsManager(schema);
    instance.save();
    return instance;
  }

  /**
   * Check if user settings exist
   */
  static exists(): boolean {
    const filePath = UserSettingsManager.getSettingsPath();
    return existsSync(filePath);
  }

  /**
   * Get the path to the settings file
   */
  private static getSettingsPath(): string {
    const projectRoot = findProjectRoot();
    return join(projectRoot, USER_SETTINGS_DIR, USER_SETTINGS_FILENAME);
  }

  /**
   * Migrate old settings to current schema version
   */
  private static migrate(data: any): UserSettings {
    // If already current version, return as-is
    if (data.version === CURRENT_USER_SCHEMA_VERSION) {
      return data as UserSettings;
    }

    // Migration from older versions
    // NOTE: Unlike createDefault() which uses empty arrays and no default agent,
    // migration provides Claude as the default for backward compatibility with
    // existing installations that may have been using Claude implicitly.
    const migrated: UserSettings = {
      version: CURRENT_USER_SCHEMA_VERSION,
      aiAgents: data.aiAgents || [AI_AGENT.Claude],
      defaults: {
        aiAgent: data.defaults?.aiAgent || AI_AGENT.Claude,
      },
    };

    return migrated;
  }

  /**
   * Save current settings to disk
   */
  save(): void {
    const filePath = UserSettingsManager.getSettingsPath();
    const projectRoot = findProjectRoot();
    const dirPath = join(projectRoot, USER_SETTINGS_DIR);

    try {
      // Ensure .rover directory exists
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }

      const json = JSON.stringify(this.data, null, 2);
      writeFileSync(filePath, json, 'utf8');
    } catch (error) {
      throw new UserSettingsSaveError(
        `Failed to save user settings: ${error}`,
        error
      );
    }
  }

  /**
   * Reload settings from disk
   */
  reload(): void {
    const reloaded = UserSettingsManager.load();
    this.data = reloaded.data;
  }

  // Data Access (Getters)
  get version(): string {
    return this.data.version;
  }
  get aiAgents(): AI_AGENT[] {
    return this.data.aiAgents;
  }
  get defaultAiAgent(): AI_AGENT | undefined {
    return this.data.defaults.aiAgent;
  }

  // Data Modification (Setters)
  /**
   * Set the default AI agent
   * Automatically adds the agent to the available agents list if not already present
   */
  setDefaultAiAgent(agent: AI_AGENT): void {
    this.data.defaults.aiAgent = agent;
    // Ensure the agent is in the available agents list
    if (!this.data.aiAgents.includes(agent)) {
      this.data.aiAgents.push(agent);
    }
    this.save();
  }

  /**
   * Add an AI agent to the available agents list
   * Does nothing if the agent is already in the list
   */
  addAiAgent(agent: AI_AGENT): void {
    if (!this.data.aiAgents.includes(agent)) {
      this.data.aiAgents.push(agent);
      this.save();
    }
  }

  /**
   * Remove an AI agent from the available agents list
   * Automatically updates the default agent if the removed agent was the current default
   */
  removeAiAgent(agent: AI_AGENT): void {
    const index = this.data.aiAgents.indexOf(agent);
    if (index > -1) {
      this.data.aiAgents.splice(index, 1);
      // If we removed the default agent, set a new default
      if (
        this.data.defaults.aiAgent === agent &&
        this.data.aiAgents.length > 0
      ) {
        this.data.defaults.aiAgent = this.data.aiAgents[0];
      }
      this.save();
    }
  }

  /**
   * Get raw JSON data
   */
  toJSON(): UserSettings {
    return structuredClone(this.data);
  }
}
