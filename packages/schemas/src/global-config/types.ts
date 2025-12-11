/**
 * TypeScript types inferred from Zod schemas
 */

import { z } from 'zod';
import {
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
