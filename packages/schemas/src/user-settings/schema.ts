/**
 * Zod schemas for runtime validation of user settings files (.rover/settings.json)
 */

import { z } from 'zod';
import { AI_AGENT } from 'rover-common';

// Current schema version
export const CURRENT_USER_SCHEMA_VERSION = '1.0';

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
