/**
 * TypeScript types for pre-context data
 * All types are inferred from Zod schemas to ensure consistency
 *
 * @deprecated This module is deprecated and will be removed in a future version.
 * Context is now tracked per-iteration in the iteration schema.
 * See: packages/schemas/src/iteration/types.ts
 */

import type { z } from 'zod';
import type { PreContextDataSchema, InitialTaskSchema } from './schema.js';

/**
 * Type for initial task information
 * @deprecated This type is deprecated and will be removed in a future version.
 */
export type InitialTask = z.infer<typeof InitialTaskSchema>;

/**
 * Type for complete pre-context data
 * @deprecated This type is deprecated and will be removed in a future version.
 * Context is now tracked per-iteration in the iteration schema.
 * See: packages/schemas/src/iteration/types.ts
 */
export type PreContextData = z.infer<typeof PreContextDataSchema>;
