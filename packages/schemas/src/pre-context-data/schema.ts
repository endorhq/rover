/**
 * Zod schemas for runtime validation of pre-context data files
 * Used when injecting context into workflow execution
 */

import { z } from 'zod';
import { PreviousIterationSchema } from '../previous-iteration/schema.js';

// Current schema version
export const CURRENT_PRE_CONTEXT_DATA_SCHEMA_VERSION = '1.0';

// Filename constant
export const PRE_CONTEXT_DATA_FILENAME = '__pre_context__.json';

/**
 * Initial task information schema
 */
export const InitialTaskSchema = z.object({
  /** Task title */
  title: z.string().min(1, 'Title is required'),
  /** Task description */
  description: z.string().min(1, 'Description is required'),
});

/**
 * Complete pre-context data schema
 * Defines the structure of a __pre_context__.json file
 */
export const PreContextDataSchema = z.object({
  /** Schema version for migrations */
  version: z.string(),
  /** The task ID */
  taskId: z.string().min(1, 'Task ID is required'),
  /** Initial task information */
  initialTask: InitialTaskSchema,
  /** Previous iterations (if any) */
  previousIterations: z.array(PreviousIterationSchema).optional(),
  /** Current (last) iteration being executed */
  currentIteration: PreviousIterationSchema.optional(),
});
