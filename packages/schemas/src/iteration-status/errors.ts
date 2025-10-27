import { ZodError } from 'zod';

/**
 * Error class for iteration status loading errors
 */
export class IterationStatusLoadError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'IterationStatusLoadError';
  }
}

/**
 * Error class for iteration status validation errors
 */
export class IterationStatusValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: ZodError
  ) {
    super(message);
    this.name = 'IterationStatusValidationError';
  }
}
