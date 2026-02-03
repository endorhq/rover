/**
 * Zod schemas for runtime validation of iteration configuration files
 */

import { z } from 'zod';

// Current schema version
export const CURRENT_ITERATION_SCHEMA_VERSION = '1.1';

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
 * Trust settings for context fetching.
 */
export const TrustSettingsSchema = z.object({
  /** Trust all authors for this context source */
  trustAllAuthors: z.boolean().optional(),
  /** List of trusted author identifiers */
  trustedAuthors: z.array(z.string()).optional(),
});

/**
 * Provenance tracking for context entries.
 */
export const ProvenanceSchema = z.object({
  /** Iteration number when this context was first added */
  addedIn: z.number().int().positive(),
  /** Iteration number when this context was last updated */
  updatedIn: z.number().int().positive().optional(),
});

/**
 * Metadata from context providers.
 * Stored as flexible record to support different provider types.
 */
export const ContextMetadataSchema = z
  .object({
    /** Context type identifier (e.g., 'github:issue', 'file', 'https:resource') */
    type: z.string(),
  })
  .loose(); // Allow additional provider-specific fields

/**
 * Context entry in iteration schema.
 * References files in iterations/{n}/context/ folder.
 */
export const IterationContextEntrySchema = z.object({
  /** URI identifying the context source */
  uri: z.string().min(1),
  /** ISO datetime when the context was fetched */
  fetchedAt: z.iso.datetime(),
  /** Relative path to the content file in the context folder */
  file: z.string().min(1),
  /** Trust settings for this context source */
  trustSettings: TrustSettingsSchema.optional(),
  /** Provenance tracking */
  provenance: ProvenanceSchema,
  /** Human-readable name for the context */
  name: z.string(),
  /** Description of the context content */
  description: z.string(),
  /** Provider-specific metadata */
  metadata: ContextMetadataSchema.optional(),
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
  createdAt: z.iso.datetime(),
  /** Previous iteration context */
  previousContext: IterationPreviousContextSchema,
  /** Context entries for this iteration */
  context: z.array(IterationContextEntrySchema),
});
