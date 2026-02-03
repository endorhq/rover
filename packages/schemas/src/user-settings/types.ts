/**
 * TypeScript types inferred from Zod schemas
 */

import type { z } from 'zod';
import type {
  AiAgentSchema,
  UserDefaultsSchema,
  UserSettingsSchema,
} from './schema.js';

// Inferred types from Zod schemas
export type AiAgent = z.infer<typeof AiAgentSchema>;
export type UserDefaults = z.infer<typeof UserDefaultsSchema>;
export type UserSettings = z.infer<typeof UserSettingsSchema>;
