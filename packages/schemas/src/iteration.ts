/**
 * Iteration configuration manager.
 * Provides methods to create, load, and manage iteration configurations.
 */
import colors from 'ansi-colors';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VERBOSE } from 'rover-common';
import { IterationStatusManager } from './iteration-status.js';
import {
  CURRENT_ITERATION_SCHEMA_VERSION,
  ITERATION_FILENAME,
  IterationSchema,
} from './iteration/schema.js';
import { ITERATION_STATUS_FILENAME } from './iteration-status/schema.js';
import { Iteration, IterationPreviousContext } from './iteration/types.js';
import {
  IterationLoadError,
  IterationValidationError,
} from './iteration/errors.js';

/**
 * Iteration configuration manager. It provides the agent with enough information to iterate over
 * the given task.
 */
export class IterationManager {
  private data: Iteration;
  private filePath: string;
  public iterationPath: string;
  private statusCache: IterationStatusManager | undefined;

  constructor(data: Iteration, iterationPath: string, filePath: string) {
    this.data = data;
    this.filePath = filePath;
    this.iterationPath = iterationPath;
    this.validate();
  }

  /**
   * Create a new iteration config for the first iteration (from task command)
   */
  static createInitial(
    iterationPath: string,
    id: number,
    title: string,
    description: string
  ): IterationManager {
    const schema: Iteration = {
      version: CURRENT_ITERATION_SCHEMA_VERSION,
      id,
      iteration: 1,
      title: title,
      description: description,
      createdAt: new Date().toISOString(),
      previousContext: {}, // Empty for first iteration
    };

    const filePath = join(iterationPath, ITERATION_FILENAME);
    const instance = new IterationManager(schema, iterationPath, filePath);
    instance.save();
    return instance;
  }

  /**
   * Create a new iteration config for subsequent iterations (from iterate command)
   */
  static createIteration(
    iterationPath: string,
    iterationNumber: number,
    id: number,
    title: string,
    description: string,
    previousContext: {
      plan?: string;
      summary?: string;
      iterationNumber?: number;
    }
  ): IterationManager {
    const schema: Iteration = {
      version: CURRENT_ITERATION_SCHEMA_VERSION,
      iteration: iterationNumber,
      id,
      title,
      description,
      createdAt: new Date().toISOString(),
      previousContext,
    };

    const filePath = join(iterationPath, ITERATION_FILENAME);
    const instance = new IterationManager(schema, iterationPath, filePath);
    instance.save();
    return instance;
  }

  /**
   * Load an existing iteration config from disk
   */
  static load(iterationPath: string): IterationManager {
    const filePath = join(iterationPath, ITERATION_FILENAME);

    if (!existsSync(filePath)) {
      throw new IterationLoadError(`Iteration config not found at ${filePath}`);
    }

    try {
      const rawData = readFileSync(filePath, 'utf8');
      const parsedData = JSON.parse(rawData);

      // Migrate if necessary
      const migratedData = IterationManager.migrate(parsedData);

      const instance = new IterationManager(
        migratedData,
        iterationPath,
        filePath
      );

      // If migration occurred, save the updated data
      if (migratedData.version !== parsedData.version) {
        instance.save();
      }

      return instance;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new IterationLoadError(
          `Invalid JSON in iteration config: ${error.message}`,
          error
        );
      }
      throw new IterationLoadError(
        `Failed to load iteration config: ${error}`,
        error
      );
    }
  }

  /**
   * Check if an iteration config exists
   */
  static exists(iterationPath: string): boolean {
    const filePath = join(iterationPath, ITERATION_FILENAME);
    return existsSync(filePath);
  }

  /**
   * Migrate old config to current schema version
   */
  private static migrate(data: any): Iteration {
    // If already current version, return as-is
    if (data.version === CURRENT_ITERATION_SCHEMA_VERSION) {
      return data as Iteration;
    }

    // Add version if missing (create new object to trigger save)
    if (!data.version) {
      return {
        ...data,
        version: CURRENT_ITERATION_SCHEMA_VERSION,
      } as Iteration;
    }

    return data as Iteration;
  }

  /**
   * Load the iteration status
   */
  status(): IterationStatusManager {
    if (this.statusCache) return this.statusCache;

    const statusPath = join(this.iterationPath, ITERATION_STATUS_FILENAME);

    if (existsSync(statusPath)) {
      try {
        const status = IterationStatusManager.load(statusPath);
        this.statusCache = status;

        return status;
      } catch (err) {
        throw new Error('There was an error loading the status.json file');
      }
    } else {
      throw new Error('The status.json file is missing for this iteration');
    }
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
      throw new IterationLoadError(`Failed to save iteration config: ${error}`);
    }
  }

  /**
   * Validate the configuration data using Zod
   */
  private validate(): void {
    const result = IterationSchema.safeParse(this.data);

    if (!result.success) {
      throw new IterationValidationError(
        `Iteration config validation error: ${result.error.message}`,
        result.error
      );
    }
  }

  // Data Access (Getters)
  get version(): string {
    return this.data.version;
  }
  get id(): number {
    return this.data.id;
  }
  get iteration(): number {
    return this.data.iteration;
  }
  get title(): string {
    return this.data.title;
  }
  get description(): string {
    return this.data.description;
  }
  get createdAt(): string {
    return this.data.createdAt;
  }
  get previousContext(): IterationPreviousContext {
    return this.data.previousContext;
  }
  get fileDescriptionPath(): string {
    return this.filePath;
  }

  /**
   * Get raw JSON data
   */
  toJSON(): Iteration {
    return { ...this.data };
  }

  /**
   * Get available markdown files in this iteration directory
   */
  getMarkdownFiles(requestedFiles?: string[]): Map<string, string> {
    const result = new Map<string, string>();

    if (!existsSync(this.iterationPath)) {
      return result;
    }

    try {
      const files = readdirSync(this.iterationPath, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
        .map(entry => entry.name)
        .sort();

      const filesToRead = requestedFiles || files;

      for (const file of filesToRead) {
        if (files.includes(file)) {
          try {
            const fileContents = readFileSync(
              join(this.iterationPath, file),
              'utf8'
            );
            result.set(file, fileContents);
          } catch (error) {
            if (VERBOSE) {
              console.error(
                colors.gray(`Error reading file ${file}: ${error}`)
              );
            }
          }
        }
      }
    } catch (error) {
      if (VERBOSE) {
        console.error(
          colors.gray(`Error listing files in ${this.iterationPath}: ${error}`)
        );
      }
    }

    return result;
  }

  /**
   * Get list of markdown filenames in this iteration directory
   */
  listMarkdownFiles(): string[] {
    if (!existsSync(this.iterationPath)) {
      return [];
    }

    try {
      return readdirSync(this.iterationPath, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
        .map(entry => entry.name)
        .sort();
    } catch (error) {
      if (VERBOSE) {
        console.error(
          colors.gray(`Error listing files in ${this.iterationPath}: ${error}`)
        );
      }
      return [];
    }
  }
}
