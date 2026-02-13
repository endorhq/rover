import type { ZodError } from 'zod';

/**
 * Error class for JSONL log write errors
 */
export class JsonlLogWriteError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'JsonlLogWriteError';
  }
}

/**
 * Error class for JSONL log read errors
 */
export class JsonlLogReadError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'JsonlLogReadError';
  }
}

/**
 * Error class for JSONL log validation errors
 */
export class JsonlLogValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: ZodError
  ) {
    super(message);
    this.name = 'JsonlLogValidationError';
  }
}
