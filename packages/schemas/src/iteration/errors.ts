import { ZodError } from 'zod';

/**
 * Error class for iteration loading errors
 */
export class IterationLoadError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'IterationLoadError';
  }
}

/**
 * Error class for iteration validation errors
 */
export class IterationValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors?: ZodError
  ) {
    super(message);
    this.name = 'IterationValidationError';
  }
}
