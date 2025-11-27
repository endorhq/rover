/**
 * Pre-context data manager.
 * Provides methods to create, load, and manage pre-context data for workflow execution.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowAgentStep } from './workflow/types.js';
import type { PreviousIteration } from './previous-iteration/types.js';
import {
  CURRENT_PRE_CONTEXT_DATA_SCHEMA_VERSION,
  PRE_CONTEXT_DATA_FILENAME,
  PreContextDataSchema,
} from './pre-context-data/schema.js';
import type { PreContextData, InitialTask } from './pre-context-data/types.js';
import {
  PreContextDataLoadError,
  PreContextDataValidationError,
} from './pre-context-data/errors.js';

/**
 * Pre-context data manager. It provides the ability to load and manage
 * pre-context information for workflow execution.
 */
export class PreContextDataManager {
  private data: PreContextData;
  private filePath: string;

  constructor(data: PreContextData, filePath: string) {
    this.data = data;
    this.filePath = filePath;
    this.validate();
  }

  /**
   * Create a new pre-context data instance
   */
  static create(
    taskDir: string,
    taskId: string,
    initialTask: InitialTask,
    previousIterations?: PreviousIteration[],
    currentIteration?: PreviousIteration
  ): PreContextDataManager {
    const data: PreContextData = {
      version: CURRENT_PRE_CONTEXT_DATA_SCHEMA_VERSION,
      taskId,
      initialTask,
      previousIterations,
      currentIteration,
    };

    const filePath = join(taskDir, PRE_CONTEXT_DATA_FILENAME);
    const instance = new PreContextDataManager(data, filePath);
    instance.save();
    return instance;
  }

  /**
   * Load existing pre-context data from disk
   */
  static load(taskDir: string): PreContextDataManager {
    const filePath = join(taskDir, PRE_CONTEXT_DATA_FILENAME);

    if (!existsSync(filePath)) {
      throw new PreContextDataLoadError(
        `Pre-context data not found at ${filePath}`
      );
    }

    try {
      const rawData = readFileSync(filePath, 'utf8');
      const parsedData = JSON.parse(rawData);

      // Migrate if necessary
      const migratedData = PreContextDataManager.migrate(parsedData);

      const instance = new PreContextDataManager(migratedData, filePath);

      // If migration occurred, save the updated data
      if (migratedData.version !== parsedData.version) {
        instance.save();
      }

      return instance;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new PreContextDataLoadError(
          `Invalid JSON in pre-context data: ${error.message}`,
          error
        );
      }
      throw new PreContextDataLoadError(
        `Failed to load pre-context data: ${error}`,
        error
      );
    }
  }

  /**
   * Check if pre-context data exists
   */
  static exists(taskDir: string): boolean {
    const filePath = join(taskDir, PRE_CONTEXT_DATA_FILENAME);
    return existsSync(filePath);
  }

  /**
   * Migrate old data to current schema version
   */
  private static migrate(data: any): PreContextData {
    // If already current version, return as-is
    if (data.version === CURRENT_PRE_CONTEXT_DATA_SCHEMA_VERSION) {
      return data as PreContextData;
    }

    // Add version if missing (create new object to trigger save)
    if (!data.version) {
      return {
        ...data,
        version: CURRENT_PRE_CONTEXT_DATA_SCHEMA_VERSION,
      } as PreContextData;
    }

    return data as PreContextData;
  }

  /**
   * Save current data to disk
   */
  save(): void {
    try {
      this.validate();
      const json = JSON.stringify(this.data, null, 2);
      writeFileSync(this.filePath, json, 'utf8');
    } catch (error) {
      throw new PreContextDataLoadError(
        `Failed to save pre-context data: ${error}`
      );
    }
  }

  /**
   * Validate the configuration data using Zod
   */
  private validate(): void {
    const result = PreContextDataSchema.safeParse(this.data);

    if (!result.success) {
      throw new PreContextDataValidationError(
        `Pre-context data validation error: ${result.error.message}`,
        result.error
      );
    }
  }

  // Data Access (Getters)
  get version(): string {
    return this.data.version;
  }

  get taskId(): string {
    return this.data.taskId;
  }

  get initialTask(): InitialTask {
    return this.data.initialTask;
  }

  get previousIterations(): PreviousIteration[] | undefined {
    return this.data.previousIterations;
  }

  get currentIteration(): PreviousIteration | undefined {
    return this.data.currentIteration;
  }

  /**
   * Get raw JSON data
   */
  toJSON(): PreContextData {
    return { ...this.data };
  }
}
