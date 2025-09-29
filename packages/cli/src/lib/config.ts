/**
 * Define the project, user configuration files and constants
 * related to those.
 */
import { join, dirname, resolve } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { FileNotFoundError, InvalidFormatError } from '../errors.js';
import { findProjectRoot, Git } from 'rover-common';

// Supported languages
export enum LANGUAGE {
  Javascript = 'javascript',
  TypeScript = 'typescript',
  PHP = 'php',
  Rust = 'rust',
  Go = 'go',
  Python = 'python',
  Ruby = 'ruby',
}

export enum PACKAGE_MANAGER {
  PNPM = 'pnpm',
  NPM = 'npm',
  Yarn = 'yarn',
  Composer = 'composer',
  Cargo = 'cargo',
  Gomod = 'gomod',
  PIP = 'pip',
  Poetry = 'poetry',
  UV = 'uv',
  Rubygems = 'rubygems',
}

export enum TASK_MANAGER {
  Just = 'just',
  Make = 'make',
  Task = 'task',
}

// Schema version for migrations
const CURRENT_PROJECT_SCHEMA_VERSION = '1.0';

export interface ProjectConfigSchema {
  // Common values
  version: string;

  // Environment
  languages: LANGUAGE[];
  packageManagers: PACKAGE_MANAGER[];
  taskManagers: TASK_MANAGER[];

  // Attribution
  attribution: boolean;
}

const PROJECT_CONFIG_FILE = 'rover.json';

/**
 * Project-wide configuration. Useful to add context and constraints. We
 * expect users to commit this file to the repo.
 */
export class ProjectConfig {
  constructor(private data: ProjectConfigSchema) {}

  /**
   * Load an existing configuration from disk
   */
  static async load(): Promise<ProjectConfig> {
    const projectRoot = await findProjectRoot();
    const filePath = join(projectRoot, PROJECT_CONFIG_FILE);

    try {
      const rawData = readFileSync(filePath, 'utf8');
      const parsedData = JSON.parse(rawData);

      // Migrate if necessary
      const migratedData = ProjectConfig.migrate(parsedData);

      const instance = new ProjectConfig(migratedData);

      // If migration occurred, save the updated data
      if (migratedData.version !== parsedData.version) {
        instance.save();
      }

      return instance;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new InvalidFormatError(filePath);
      } else {
        throw new Error('Failed to load the project configuration.');
      }
    }
  }

  /**
   * Create a new project configuration with defaults
   */
  static create(): ProjectConfig {
    const schema: ProjectConfigSchema = {
      version: CURRENT_PROJECT_SCHEMA_VERSION,
      languages: [],
      packageManagers: [],
      taskManagers: [],
      attribution: true,
    };

    const instance = new ProjectConfig(schema);
    instance.save();
    return instance;
  }

  /**
   * Check if a project configuration exists
   */
  static async exists(): Promise<boolean> {
    const projectRoot = await findProjectRoot();
    const filePath = join(projectRoot, PROJECT_CONFIG_FILE);
    return existsSync(filePath);
  }

  /**
   * Check if a project configuration exists (synchronous version using current directory)
   */
  static existsSync(): boolean {
    const filePath = join(process.cwd(), PROJECT_CONFIG_FILE);
    return existsSync(filePath);
  }

  /**
   * Migrate old configuration to current schema version
   */
  private static migrate(data: any): ProjectConfigSchema {
    // If already current version, return as-is
    if (data.version === CURRENT_PROJECT_SCHEMA_VERSION) {
      return data as ProjectConfigSchema;
    }

    // For now, just ensure all required fields exist
    const migrated: ProjectConfigSchema = {
      version: CURRENT_PROJECT_SCHEMA_VERSION,
      languages: data.languages || [],
      packageManagers: data.packageManagers || [],
      taskManagers: data.taskManagers || [],
      attribution: data.attribution || true,
    };

    return migrated;
  }

  /**
   * Save current configuration to disk
   */
  async save(): Promise<void> {
    const projectRoot = await findProjectRoot();
    const filePath = join(projectRoot, PROJECT_CONFIG_FILE);
    try {
      const json = JSON.stringify(this.data, null, 2);
      writeFileSync(filePath, json, 'utf8');
    } catch (error) {
      throw new Error(`Failed to save project configuration: ${error}`);
    }
  }

  /**
   * Reload configuration from disk
   */
  async reload(): Promise<void> {
    const reloaded = await ProjectConfig.load();
    this.data = reloaded.data;
  }

  // Data Access (Getters)
  get version(): string {
    return this.data.version;
  }
  get languages(): LANGUAGE[] {
    return this.data.languages;
  }
  get packageManagers(): PACKAGE_MANAGER[] {
    return this.data.packageManagers;
  }
  get taskManagers(): TASK_MANAGER[] {
    return this.data.taskManagers;
  }
  get attribution(): boolean {
    return this.data.attribution;
  }

  // Data Modification (Setters)
  async addLanguage(language: LANGUAGE): Promise<void> {
    if (!this.data.languages.includes(language)) {
      this.data.languages.push(language);
      await this.save();
    }
  }

  async removeLanguage(language: LANGUAGE): Promise<void> {
    const index = this.data.languages.indexOf(language);
    if (index > -1) {
      this.data.languages.splice(index, 1);
      await this.save();
    }
  }

  async addPackageManager(packageManager: PACKAGE_MANAGER): Promise<void> {
    if (!this.data.packageManagers.includes(packageManager)) {
      this.data.packageManagers.push(packageManager);
      await this.save();
    }
  }

  async removePackageManager(packageManager: PACKAGE_MANAGER): Promise<void> {
    const index = this.data.packageManagers.indexOf(packageManager);
    if (index > -1) {
      this.data.packageManagers.splice(index, 1);
      await this.save();
    }
  }

  async addTaskManager(taskManager: TASK_MANAGER): Promise<void> {
    if (!this.data.taskManagers.includes(taskManager)) {
      this.data.taskManagers.push(taskManager);
      await this.save();
    }
  }

  async removeTaskManager(taskManager: TASK_MANAGER): Promise<void> {
    const index = this.data.taskManagers.indexOf(taskManager);
    if (index > -1) {
      this.data.taskManagers.splice(index, 1);
      await this.save();
    }
  }

  async setAttribution(value: boolean): Promise<void> {
    this.data.attribution = value;
    await this.save();
  }

  /**
   * Get raw JSON data
   */
  toJSON(): ProjectConfigSchema {
    return { ...this.data };
  }
}

export enum AI_AGENT {
  Claude = 'claude',
  Codex = 'codex',
  Gemini = 'gemini',
  Qwen = 'qwen',
}

const CURRENT_USER_SCHEMA_VERSION = '1.0';

export interface UserSettingsSchema {
  // Common values
  version: string;

  // Local tools
  aiAgents: AI_AGENT[];

  // User preferences
  defaults: {
    aiAgent?: AI_AGENT;
  };
}

/**
 * User-specific configuration. Useful to tailor the rover behavior for an user.
 * We do not expect users commiting this file to the repo.
 */
export class UserSettings {
  constructor(private data: UserSettingsSchema) {}

  /**
   * Load user settings from disk
   */
  static async load(): Promise<UserSettings> {
    const filePath = await UserSettings.getSettingsPath();

    if (!existsSync(filePath)) {
      // Return default settings if file doesn't exist
      return UserSettings.createDefault();
    }

    try {
      const rawData = readFileSync(filePath, 'utf8');
      const parsedData = JSON.parse(rawData);

      // Migrate if necessary
      const migratedData = UserSettings.migrate(parsedData);

      const instance = new UserSettings(migratedData);

      // If migration occurred, save the updated data
      if (migratedData.version !== parsedData.version) {
        instance.save();
      }

      return instance;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new InvalidFormatError(filePath);
      } else {
        throw new Error('Failed to load user settings.');
      }
    }
  }

  /**
   * Create default user settings
   */
  static createDefault(): UserSettings {
    const schema: UserSettingsSchema = {
      version: CURRENT_USER_SCHEMA_VERSION,
      aiAgents: [],
      defaults: {},
    };

    const instance = new UserSettings(schema);
    instance.save();
    return instance;
  }

  /**
   * Check if user settings exist
   */
  static async exists(): Promise<boolean> {
    const filePath = await UserSettings.getSettingsPath();
    return existsSync(filePath);
  }

  /**
   * Check if user settings exist (synchronous version using current directory)
   */
  static existsSync(): boolean {
    const filePath = join(process.cwd(), '.rover', 'settings.json');
    return existsSync(filePath);
  }

  /**
   * Get the path to the settings file
   */
  private static async getSettingsPath(): Promise<string> {
    const projectRoot = await findProjectRoot();
    return join(projectRoot, '.rover', 'settings.json');
  }

  /**
   * Migrate old settings to current schema version
   */
  private static migrate(data: any): UserSettingsSchema {
    // If already current version, return as-is
    if (data.version === CURRENT_USER_SCHEMA_VERSION) {
      return data as UserSettingsSchema;
    }

    // For now, just ensure all required fields exist
    const migrated: UserSettingsSchema = {
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
  async save(): Promise<void> {
    const filePath = await UserSettings.getSettingsPath();
    const projectRoot = await findProjectRoot();
    const dirPath = join(projectRoot, '.rover');

    try {
      // Ensure .rover directory exists
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
      }

      const json = JSON.stringify(this.data, null, 2);
      writeFileSync(filePath, json, 'utf8');
    } catch (error) {
      throw new Error(`Failed to save user settings: ${error}`);
    }
  }

  /**
   * Reload settings from disk
   */
  async reload(): Promise<void> {
    const reloaded = await UserSettings.load();
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
  async setDefaultAiAgent(agent: AI_AGENT): Promise<void> {
    this.data.defaults.aiAgent = agent;
    // Ensure the agent is in the available agents list
    if (!this.data.aiAgents.includes(agent)) {
      this.data.aiAgents.push(agent);
    }
    await this.save();
  }

  async addAiAgent(agent: AI_AGENT): Promise<void> {
    if (!this.data.aiAgents.includes(agent)) {
      this.data.aiAgents.push(agent);
      await this.save();
    }
  }

  async removeAiAgent(agent: AI_AGENT): Promise<void> {
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
      await this.save();
    }
  }

  /**
   * Get raw JSON data
   */
  toJSON(): UserSettingsSchema {
    return { ...this.data };
  }
}
