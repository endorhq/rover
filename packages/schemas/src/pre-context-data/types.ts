/**
 * TypeScript types for pre-context data
 * All types are inferred from Zod schemas to ensure consistency
 */

import { z } from 'zod';
import { PreContextDataSchema, InitialTaskSchema } from './schema.js';

/**
 * Type for initial task information
 */
export type InitialTask = z.infer<typeof InitialTaskSchema>;

/**
 * Type for complete pre-context data
 */
export type PreContextData = z.infer<typeof PreContextDataSchema>;
