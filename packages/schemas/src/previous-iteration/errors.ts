import { ZodError } from 'zod';

/**
 * Error class for previous iteration validation errors
 */
export class PreviousIterationValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors?: ZodError
  ) {
    super(message);
    this.name = 'PreviousIterationValidationError';
  }
}
