/**
 * Zod schemas for runtime validation of iteration status tracking
 */

import { z } from 'zod';

// Filename constants
export const ITERATION_STATUS_FILENAME = 'status.json';

/**
 * Supported status names
 */
export const IterationStatusNameSchema = z.enum([
  'initializing',
  'running',
  'completed',
  'failed',
]);

/**
 * Schema for iteration status tracking
 * Represents the state of an iteration during workflow execution
 */
export const IterationStatusSchema = z.object({
  /** Original Task ID */
  taskId: z.string(),

  /** Status name (e.g., 'initializing', 'running', 'completed', 'failed') */
  status: IterationStatusNameSchema,

  /** Current step name and progress */
  currentStep: z.string(),
  progress: z.number(),

  /** Timestamps in ISO 8601 format */
  startedAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),

  /** Error information */
  error: z.string().optional(),
});
