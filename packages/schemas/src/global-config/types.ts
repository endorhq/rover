/**
 * TypeScript types inferred from Zod schemas
 */

import type { z } from 'zod';
import type {
  TelemetryStatusSchema,
  GlobalProjectSchema,
  GlobalConfigSchema,
  AttributionStatusSchema,
} from './schema.js';

// Inferred types from Zod schemas
export type TelemetryStatus = z.infer<typeof TelemetryStatusSchema>;
export type AttributionStatus = z.infer<typeof AttributionStatusSchema>;
export type GlobalProject = z.infer<typeof GlobalProjectSchema>;
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
