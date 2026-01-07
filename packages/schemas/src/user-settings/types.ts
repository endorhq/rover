/**
 * TypeScript types inferred from Zod schemas
 */

import { z } from 'zod';
import {
  AiAgentSchema,
  UserDefaultsSchema,
  UserSettingsSchema,
  WorkflowStepConfigSchema,
  WorkflowStepsConfigSchema,
} from './schema.js';

// Inferred types from Zod schemas
export type AiAgent = z.infer<typeof AiAgentSchema>;
export type UserDefaults = z.infer<typeof UserDefaultsSchema>;
export type UserSettings = z.infer<typeof UserSettingsSchema>;
export type WorkflowStepConfig = z.infer<typeof WorkflowStepConfigSchema>;
export type WorkflowStepsConfig = z.infer<typeof WorkflowStepsConfigSchema>;
