/**
 * Zod schemas for runtime validation of previous iteration data
 * Used when building pre-context information for workflow execution
 */

import { z } from 'zod';

/**
 * Schema for previous iteration information
 * Represents summary data about a completed iteration
 */
export const PreviousIterationSchema = z.object({
  /** The iteration number */
  number: z.number().min(1, 'Iteration number must be at least 1'),
  /** Optional title of the iteration */
  title: z.string().optional(),
  /** Optional description of what was done in this iteration */
  description: z.string().optional(),
  /** Optional changes made (typically from changes.md) */
  changes: z.string().optional(),
});
