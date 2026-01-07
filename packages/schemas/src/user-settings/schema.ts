/**
 * Zod schemas for runtime validation of user settings files (.rover/settings.json)
 */

import { z } from 'zod';
import { AI_AGENT } from 'rover-core';

// Current schema version
export const CURRENT_USER_SCHEMA_VERSION = '1.2';

// Filename constants
export const USER_SETTINGS_FILENAME = 'settings.json';
export const USER_SETTINGS_DIR = '.rover';

/**
 * AI agent enum schema
 */
export const AiAgentSchema = z.nativeEnum(AI_AGENT);

/**
 * Workflow step config schema (tool and model for a specific step)
 */
export const WorkflowStepConfigSchema = z.object({
  /** AI tool to use for this step */
  tool: z.string().optional(),
  /** Model to use for this step */
  model: z.string().optional(),
});

/**
 * Workflow steps config schema (map of step ID to config)
 */
export const WorkflowStepsConfigSchema = z.record(
  z.string(),
  WorkflowStepConfigSchema
);

/**
 * User defaults schema
 */
export const UserDefaultsSchema = z.object({
  /** Default AI agent to use */
  aiAgent: AiAgentSchema.optional(),
  /** Default model per agent (e.g., { "claude": "opus", "gemini": "flash" }) */
  models: z.record(z.string(), z.string()).optional(),
  /** Per-step tool/model config for workflows (e.g., { "swe": { "implement": { "tool": "claude", "model": "opus" } } }) */
  workflows: z.record(z.string(), WorkflowStepsConfigSchema).optional(),
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
