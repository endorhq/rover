/**
 * Zod schemas for runtime validation of user settings files (.rover/settings.json)
 */

import { z } from 'zod';
import { AI_AGENT } from 'rover-core';

// Current schema version
export const CURRENT_USER_SCHEMA_VERSION = '1.1';

// Filename constants
export const USER_SETTINGS_FILENAME = 'settings.json';
export const USER_SETTINGS_DIR = '.rover';

/**
 * AI agent enum schema
 */
export const AiAgentSchema = z.nativeEnum(AI_AGENT);

/**
 * User defaults schema
 */
export const UserDefaultsSchema = z.object({
  /** Default AI agent to use */
  aiAgent: AiAgentSchema.optional(),
  /** Default model per agent (e.g., { "claude": "opus", "gemini": "flash" }) */
  models: z.record(z.string(), z.string()).optional(),
});

/**
 * Complete user settings schema
 * Defines the structure of a .rover/settings.json file
 */
export const UserSettingsSchema = z.object({
  /** Schema version for migrations */
  version: z.string(),
  /** Available AI agents */
  aiAgents: z.array(AiAgentSchema),
  /** User default preferences */
  defaults: UserDefaultsSchema,
});
