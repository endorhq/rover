/**
 * Define the iteration file that Rover will use to generate the setup script and
 * the prompts.
 */
import colors from 'ansi-colors';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaskDescription } from './description.js';
import { VERBOSE, type IterationStatusSchema } from 'rover-common';

const CURRENT_ITERATION_SCHEMA_VERSION = '1.0';
export const ITERATION_FILENAME = 'iteration.json';
export const ITERATION_STATUS_FILENAME = 'status.json';

export interface IterationConfigSchema {
  // Schema version for migrations
  version: string;

  // The task ID
  id: number;

  // Iteration number from the task
  iteration: number;

  // Iteration title and description
  title: string;
  description: string;

  // Timestamps
  createdAt: string; // ISO datetime string

  // Previous iteration context
  previousContext: {
    plan?: string; // Previous plan.md content
    summary?: string; // Previous summary.md content
    iterationNumber?: number; // Previous iteration number
  };
}

/**
 * Iteration configuration. It provides the agent with enough information to iterate over
 * the given task.
 */
export class IterationConfig {
  private data: IterationConfigSchema;
  private filePath: string;
  private iterationPath: string;
  private statusCache: IterationStatusSchema | undefined;

  constructor(
    data: IterationConfigSchema,
    iterationPath: string,
    filePath: string
  ) {
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
  ): IterationConfig {
    const schema: IterationConfigSchema = {
      version: CURRENT_ITERATION_SCHEMA_VERSION,
      id,
      iteration: 1,
      title: title,
      description: description,
      createdAt: new Date().toISOString(),
      previousContext: {}, // Empty for first iteration
    };

    const filePath = join(iterationPath, ITERATION_FILENAME);
    const instance = new IterationConfig(schema, iterationPath, filePath);
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
      changes?: string;
      iterationNumber?: number;
    }
  ): IterationConfig {
    const schema: IterationConfigSchema = {
      version: CURRENT_ITERATION_SCHEMA_VERSION,
      iteration: iterationNumber,
      id,
      title,
      description,
      createdAt: new Date().toISOString(),
      previousContext,
    };

    const filePath = join(iterationPath, ITERATION_FILENAME);
    const instance = new IterationConfig(schema, iterationPath, filePath);
    instance.save();
    return instance;
  }

  /**
   * Load an existing iteration config from disk
   */
  static load(iterationPath: string): IterationConfig {
    const filePath = join(iterationPath, ITERATION_FILENAME);

    if (!existsSync(filePath)) {
      throw new Error(`Iteration config not found at ${filePath}`);
    }

    try {
      const rawData = readFileSync(filePath, 'utf8');
      const parsedData = JSON.parse(rawData);

      // Migrate if necessary
      const migratedData = IterationConfig.migrate(parsedData);

      const instance = new IterationConfig(
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
        throw new Error(`Invalid JSON in iteration config: ${error.message}`);
      }
      throw new Error(`Failed to load iteration config: ${error}`);
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
  private static migrate(data: any): IterationConfigSchema {
    // If already current version, return as-is
    if (data.version === CURRENT_ITERATION_SCHEMA_VERSION) {
      return data as IterationConfigSchema;
    }

    // For now, just return the data as-is since we're starting fresh
    return data as IterationConfigSchema;
  }

  /**
   * Load the iteration status
   */
  status(): IterationStatusSchema {
    if (this.statusCache) return this.statusCache;

    const statusPath = join(this.iterationPath, ITERATION_STATUS_FILENAME);

    if (existsSync(statusPath)) {
      try {
        const content = readFileSync(statusPath, 'utf8');
        const status = JSON.parse(content) as IterationStatusSchema;
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
      throw new Error(`Failed to save iteration config: ${error}`);
    }
  }

  /**
   * Validate the configuration data
   */
  private validate(): void {
    const errors: string[] = [];

    // Required fields
    if (typeof this.data.version !== 'string')
      errors.push('version is required');
    if (typeof this.data.iteration !== 'number')
      errors.push('iteration must be a number');
    if (this.data.iteration < 1) errors.push('iteration must be at least 1');
    if (typeof this.data.title !== 'string' || !this.data.title)
      errors.push('title is required');
    if (typeof this.data.description !== 'string' || !this.data.description)
      errors.push('description is required');
    if (!this.data.createdAt) errors.push('createdAt is required');

    // Date validation
    if (this.data.createdAt && isNaN(Date.parse(this.data.createdAt))) {
      errors.push('createdAt must be a valid ISO date string');
    }

    if (errors.length > 0) {
      throw new Error(
        `Iteration config validation error: ${errors.join(', ')}`
      );
    }
  }

  // Data Access (Getters)
  get version(): string {
    return this.data.version;
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
  get previousContext(): {
    plan?: string;
    summary?: string;
    iterationNumber?: number;
  } {
    return this.data.previousContext;
  }

  /**
   * Get raw JSON data
   */
  toJSON(): IterationConfigSchema {
    return { ...this.data };
  }
}

/**
 * Load all the iterations for a given task
 */
export const getTaskIterations = (task: TaskDescription): IterationConfig[] => {
  const iterations: IterationConfig[] = [];
  const iterationsPath = task.iterationsPath();

  if (existsSync(iterationsPath)) {
    try {
      const iterationsIds = readdirSync(iterationsPath, {
        withFileTypes: true,
      })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => parseInt(dirent.name, 10))
        .filter(num => !isNaN(num))
        .sort((a, b) => b - a); // Sort descending to get latest first

      iterationsIds.forEach(id => {
        try {
          iterations.push(
            IterationConfig.load(join(iterationsPath, id.toString()))
          );
        } catch (err) {
          // For now, just logging
          if (VERBOSE) {
            console.error(
              colors.gray(
                `Error loading iteration ${id} for task ${task.id}: ` + err
              )
            );
          }
        }
      });
    } catch (err) {
      if (VERBOSE) {
        console.error(
          colors.gray(`Error retrieving iterations for task ${task.id}: ` + err)
        );
      }

      throw new Error('There was an error retrieving the task iterations');
    }
  }

  return iterations;
};

/**
 * Retrieve the lastest iteration for a given task
 */
export const getLastTaskIteration = (
  task: TaskDescription
): IterationConfig | undefined => {
  let taskIteration: IterationConfig | undefined;
  const iterationsPath = task.iterationsPath();

  if (existsSync(iterationsPath)) {
    try {
      const iterationsIds = readdirSync(iterationsPath, {
        withFileTypes: true,
      })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => parseInt(dirent.name, 10))
        .filter(num => !isNaN(num))
        .sort((a, b) => b - a); // Sort descending to get latest first

      if (iterationsIds.length > 0) {
        taskIteration = IterationConfig.load(
          join(iterationsPath, iterationsIds[0].toString())
        );
      } else {
        if (VERBOSE) {
          console.error(
            colors.gray(`Did not find any iteration for task ${task.id}`)
          );
        }
      }
    } catch (err) {
      if (VERBOSE) {
        console.error(
          colors.gray(`Error retrieving iterations for task ${task.id}: ` + err)
        );
      }

      throw new Error('There was an error retrieving the task iterations');
    }
  }

  return taskIteration;
};
