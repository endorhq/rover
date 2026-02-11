/**
 * Zod schemas for runtime validation of JSONL structured log entries
 */

import { z } from 'zod';

// Filename constants
export const ROVER_LOG_FILENAME = 'rover.jsonl';
export const AGENT_LOGS_DIR = 'agent-logs';

/**
 * Supported log levels
 */
export const LogLevelSchema = z.enum(['info', 'warn', 'error', 'debug']);

/**
 * Supported log event types
 */
export const LogEventSchema = z.enum([
  'workflow_start',
  'workflow_complete',
  'workflow_fail',
  'step_start',
  'step_complete',
  'step_fail',
  'agent_error',
  'agent_auth_error',
  'agent_timeout',
  'agent_recovery',
]);

/**
 * Schema for a single JSONL log entry
 */
export const JsonlLogEntrySchema = z.object({
  /** ISO 8601 timestamp */
  timestamp: z.string(),

  /** Log level */
  level: LogLevelSchema,

  /** Event type */
  event: LogEventSchema,

  /** Human-readable message */
  message: z.string(),

  /** Task ID */
  taskId: z.string().optional(),

  /** Step ID */
  stepId: z.string().optional(),

  /** Step name */
  stepName: z.string().optional(),

  /** Agent tool name (e.g., "claude", "codex") */
  agent: z.string().optional(),

  /** Duration in seconds */
  duration: z.number().optional(),

  /** Consumed tokens */
  tokens: z.number().optional(),

  /** Cost in USD */
  cost: z.number().optional(),

  /** Model used */
  model: z.string().optional(),

  /** Error message */
  error: z.string().optional(),

  /** Error code */
  errorCode: z.string().optional(),

  /** Whether the error is retryable */
  errorRetryable: z.boolean().optional(),

  /** Progress percentage (0-100) */
  progress: z.number().optional(),

  /** Arbitrary metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
});
