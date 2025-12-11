import { ZodError } from 'zod';

/**
 * Error class for global configuration loading errors
 */
export class GlobalConfigLoadError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'GlobalConfigLoadError';
  }
}

/**
 * Error class for global configuration validation errors
 */
export class GlobalConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors?: ZodError
  ) {
    super(message);
    this.name = 'GlobalConfigValidationError';
  }
}

/**
 * Error class for global configuration save errors
 */
export class GlobalConfigSaveError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'GlobalConfigSaveError';
  }
}
