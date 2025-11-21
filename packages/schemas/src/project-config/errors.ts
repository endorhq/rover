import { ZodError } from 'zod';

/**
 * Error class for project configuration loading errors
 */
export class ProjectConfigLoadError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ProjectConfigLoadError';
  }
}

/**
 * Error class for project configuration validation errors
 */
export class ProjectConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors?: ZodError
  ) {
    super(message);
    this.name = 'ProjectConfigValidationError';
  }
}

/**
 * Error class for project configuration save errors
 */
export class ProjectConfigSaveError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ProjectConfigSaveError';
  }
}
