import { ZodError } from 'zod';

/**
 * Error class for workflow loading errors
 */
export class WorkflowLoadError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'WorkflowLoadError';
  }
}

/**
 * Error class for workflow validation errors
 */
export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: ZodError
  ) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}
