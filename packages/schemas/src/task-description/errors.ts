/**
 * Task description error classes.
 * Custom exceptions for task-related operations.
 */

export class TaskNotFoundError extends Error {
  constructor(taskId: number) {
    super(`Task ${taskId} not found`);
    this.name = 'TaskNotFoundError';
  }
}

export class TaskValidationError extends Error {
  constructor(message: string) {
    super(`Task validation error: ${message}`);
    this.name = 'TaskValidationError';
  }
}

export class TaskSchemaError extends Error {
  constructor(message: string) {
    super(`Task schema error: ${message}`);
    this.name = 'TaskSchemaError';
  }
}

export class TaskFileError extends Error {
  constructor(message: string) {
    super(`Task file error: ${message}`);
    this.name = 'TaskFileError';
  }
}
