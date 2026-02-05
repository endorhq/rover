/**
 * TypeScript types for iteration configuration
 * All types are inferred from Zod schemas to ensure consistency
 */

import type { z } from 'zod';
import type {
  IterationSchema,
  IterationPreviousContextSchema,
  TrustSettingsSchema,
  ProvenanceSchema,
  ContextMetadataSchema,
  IterationContextEntrySchema,
} from './schema.js';

// Main iteration type
export type Iteration = z.infer<typeof IterationSchema>;

// Previous context type
export type IterationPreviousContext = z.infer<
  typeof IterationPreviousContextSchema
>;

// Trust settings type
export type TrustSettings = z.infer<typeof TrustSettingsSchema>;

// Provenance type
export type Provenance = z.infer<typeof ProvenanceSchema>;

// Context metadata type
export type ContextMetadata = z.infer<typeof ContextMetadataSchema>;

// Iteration context entry type
export type IterationContextEntry = z.infer<typeof IterationContextEntrySchema>;
