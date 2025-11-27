import { ZodError } from 'zod';

/**
 * Error class for pre-context data loading errors
 */
export class PreContextDataLoadError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PreContextDataLoadError';
  }
}

/**
 * Error class for pre-context data validation errors
 */
export class PreContextDataValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors?: ZodError
  ) {
    super(message);
    this.name = 'PreContextDataValidationError';
  }
}
