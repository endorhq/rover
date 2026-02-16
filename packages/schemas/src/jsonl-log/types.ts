/**
 * TypeScript types for JSONL structured log entries
 * All types are inferred from Zod schemas to ensure consistency
 */

import type { z } from 'zod';
import type {
  JsonlLogEntrySchema,
  LogLevelSchema,
  LogEventSchema,
} from './schema.js';

/**
 * Type representing a log level
 */
export type LogLevel = z.infer<typeof LogLevelSchema>;

/**
 * Type representing a log event type
 */
export type LogEvent = z.infer<typeof LogEventSchema>;

/**
 * Type representing a single JSONL log entry
 */
export type JsonlLogEntry = z.infer<typeof JsonlLogEntrySchema>;
