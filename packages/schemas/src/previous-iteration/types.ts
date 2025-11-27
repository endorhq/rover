/**
 * TypeScript types for previous iteration data
 * All types are inferred from Zod schemas to ensure consistency
 */

import { z } from 'zod';
import { PreviousIterationSchema } from './schema.js';

/**
 * Type representing information about a previous iteration
 */
export type PreviousIteration = z.infer<typeof PreviousIterationSchema>;
