import { ZodError } from 'zod';

/**
 * Error class for user settings loading errors
 */
export class UserSettingsLoadError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'UserSettingsLoadError';
  }
}

/**
 * Error class for user settings validation errors
 */
export class UserSettingsValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors?: ZodError
  ) {
    super(message);
    this.name = 'UserSettingsValidationError';
  }
}

/**
 * Error class for user settings save errors
 */
export class UserSettingsSaveError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'UserSettingsSaveError';
  }
}
