import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Schema for iteration status tracking
 */
export interface IterationStatusSchema {
  // Original Task ID
  taskId: string;

  // Status name
  status: string;

  // Current step name and progress
  currentStep: string;
  progress: number;

  // Timestamps
  startedAt: string;
  updatedAt: string;
  completedAt?: string;

  // Error information
  error?: string;
}

/**
 * IterationStatus class - Manages iteration status tracking and persistence
 * Provides methods to create, load, update, and save status information
 */
export class IterationStatus {
  private data: IterationStatusSchema;
  private filePath: string;

  private constructor(data: IterationStatusSchema, filePath: string) {
    this.data = data;
    this.filePath = filePath;
  }

  /**
   * Create a new initial iteration status
   */
  static createInitial(
    filePath: string,
    taskId: string,
    currentStep: string
  ): IterationStatus {
    const now = new Date().toISOString();

    const schema: IterationStatusSchema = {
      taskId,
      status: 'initializing',
      currentStep,
      progress: 0,
      startedAt: now,
      updatedAt: now,
    };

    const instance = new IterationStatus(schema, filePath);
    instance.save();
    return instance;
  }

  /**
   * Load an existing iteration status from disk
   */
  static load(filePath: string): IterationStatus {
    if (!existsSync(filePath)) {
      throw new Error(`Status file not found at ${filePath}`);
    }

    try {
      const rawData = readFileSync(filePath, 'utf8');
      const parsedData = JSON.parse(rawData) as IterationStatusSchema;
      return new IterationStatus(parsedData, filePath);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in status file: ${error.message}`);
      }
      throw new Error(
        `Failed to load status file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Update status with new information
   */
  update(
    status: string,
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
  toJSON(): IterationStatusSchema {
    return { ...this.data };
  }
}
