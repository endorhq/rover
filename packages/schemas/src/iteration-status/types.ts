/**
 * TypeScript types for iteration status tracking
 * All types are inferred from Zod schemas to ensure consistency
 */

import { z } from 'zod';
import { IterationStatusSchema, IterationStatusNameSchema } from './schema.js';

/**
 * Type representing a specific status name for the current iteration
 * Inferred from IterationStatusNameSchema to ensure type safety
 */
export type IterationStatusName = z.infer<typeof IterationStatusNameSchema>;

/**
 * Type representing the iteration status data structure
 * Inferred from IterationStatusSchema to ensure type safety
 */
export type IterationStatus = z.infer<typeof IterationStatusSchema>;
