/**
 * TypeScript types for iteration configuration
 * All types are inferred from Zod schemas to ensure consistency
 */

import { z } from 'zod';
import { IterationSchema, IterationPreviousContextSchema } from './schema.js';

// Main iteration type
export type Iteration = z.infer<typeof IterationSchema>;

// Previous context type
export type IterationPreviousContext = z.infer<
  typeof IterationPreviousContextSchema
>;
