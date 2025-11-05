/**
 * Zod schemas for runtime validation of iteration configuration files
 */

import { z } from 'zod';

// Current schema version
export const CURRENT_ITERATION_SCHEMA_VERSION = '1.0';

// Filename constants
export const ITERATION_FILENAME = 'iteration.json';

/**
 * Previous iteration context schema
 */
export const IterationPreviousContextSchema = z.object({
  /** Previous plan.md content */
  plan: z.string().optional(),
  /** Previous summary.md content */
  summary: z.string().optional(),
  /** Previous iteration number */
  iterationNumber: z.number().optional(),
});

/**
 * Complete iteration configuration schema
 * Defines the structure of an iteration.json file
 */
export const IterationSchema = z.object({
  /** Schema version for migrations */
  version: z.string(),
  /** The task ID */
  id: z.number(),
  /** Iteration number from the task */
  iteration: z.number().min(1, 'Iteration must be at least 1'),
  /** Iteration title */
  title: z.string().min(1, 'Title is required'),
  /** Iteration description */
  description: z.string().min(1, 'Description is required'),
  /** ISO datetime string */
  createdAt: z.string().datetime(),
  /** Previous iteration context */
  previousContext: IterationPreviousContextSchema,
});
