/**
 * Iteration status manager for tracking workflow execution progress.
 * Handles loading, validating, and managing iteration status with file persistence.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { ZodError } from 'zod';
import { IterationStatusSchema } from './iteration-status/schema.js';
import type {
  IterationStatus,
  IterationStatusName,
} from './iteration-status/types.js';
import {
  IterationStatusLoadError,
  IterationStatusValidationError,
} from './iteration-status/errors.js';

/**
 * IterationStatusManager class - Manages iteration status tracking and persistence.
 * Provides methods to create, load, update, and save status information with Zod validation.
 */
export class IterationStatusManager {
  private data: IterationStatus;
  private filePath: string;

  private constructor(data: unknown, filePath: string) {
    try {
      // Validate data with Zod schema
      this.data = IterationStatusSchema.parse(data);
      this.filePath = filePath;
    } catch (error) {
      if (error instanceof ZodError) {
        const errorMessages = error.issues
          .map(err => `  - ${err.path.join('.')}: ${err.message}`)
          .join('\n');
        throw new IterationStatusValidationError(
          `Iteration status validation failed:\n${errorMessages}`,
          error
        );
      }
      throw error;
    }
  }

  /**
   * Create a new initial iteration status
   */
  static createInitial(
    filePath: string,
    taskId: string,
    currentStep: string
  ): IterationStatusManager {
    const now = new Date().toISOString();

    const statusData = {
      taskId,
      status: 'initializing',
      currentStep,
      progress: 0,
      startedAt: now,
      updatedAt: now,
    };

    const instance = new IterationStatusManager(statusData, filePath);
    instance.save();
    return instance;
  }

  /**
   * Load an existing iteration status from disk
   */
  static load(filePath: string): IterationStatusManager {
    if (!existsSync(filePath)) {
      throw new IterationStatusLoadError(
        `Status file not found at ${filePath}`
      );
    }

    try {
      const rawData = readFileSync(filePath, 'utf8');
      const parsedData = JSON.parse(rawData);
      return new IterationStatusManager(parsedData, filePath);
    } catch (error) {
      // Re-throw validation errors as-is
      if (error instanceof IterationStatusValidationError) {
        throw error;
      }
      if (error instanceof SyntaxError) {
        throw new IterationStatusLoadError(
          `Invalid JSON in status file: ${error.message}`,
          error
        );
      }
      if (error instanceof Error) {
        throw new IterationStatusLoadError(
          `Failed to load status file: ${error.message}`,
          error
        );
      }
      throw new IterationStatusLoadError(
        `Failed to load status file: ${String(error)}`
      );
    }
  }

  /**
   * Update status with new information
   */
  update(
    status: IterationStatusName,
    currentStep: string,
    progress: number,
    error?: string
  ): void {
    this.data.status = status;
    this.data.currentStep = currentStep;
    this.data.progress = progress;
    this.data.updatedAt = new Date().toISOString();

    if (error) {
      this.data.error = error;
    }

    this.save();
  }

  /**
   * Mark status as completed
   */
  complete(currentStep: string): void {
    const now = new Date().toISOString();
    this.data.status = 'completed';
    this.data.currentStep = currentStep;
    this.data.progress = 100;
    this.data.updatedAt = now;
    this.data.completedAt = now;
    this.save();
  }

  /**
   * Mark status as failed with error message
   */
  fail(currentStep: string, error: string): void {
    const now = new Date().toISOString();
    this.data.status = 'failed';
    this.data.currentStep = currentStep;
    this.data.progress = 100;
    this.data.error = error;
    this.data.updatedAt = now;
    this.data.completedAt = now;
    this.save();
  }

  /**
   * Save current status to disk
   */
  private save(): void {
    try {
      const json = JSON.stringify(this.data, null, 2);
      writeFileSync(this.filePath, json, 'utf8');
    } catch (error) {
      // Log error but don't throw to avoid breaking workflow execution
      console.error(
        `Warning: Failed to save status file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Getters for accessing status data
  get taskId(): string {
    return this.data.taskId;
  }

  get status(): string {
    return this.data.status;
  }

  get currentStep(): string {
    return this.data.currentStep;
  }

  get progress(): number {
    return this.data.progress;
  }

  get startedAt(): string {
    return this.data.startedAt;
  }

  get updatedAt(): string {
    return this.data.updatedAt;
  }

  get completedAt(): string | undefined {
    return this.data.completedAt;
  }

  get error(): string | undefined {
    return this.data.error;
  }

  /**
   * Get raw JSON data
   */
  toJSON(): IterationStatus {
    return { ...this.data };
  }
}
