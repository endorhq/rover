/**
 * Zod schemas for runtime validation of global configuration files
 */

import { z } from 'zod';
import { AI_AGENT } from 'rover-core';
import {
  LanguageSchema,
  PackageManagerSchema,
  TaskManagerSchema,
} from '../project-config/schema.js';

// Current schema version
export const CURRENT_GLOBAL_CONFIG_VERSION = '1.0';

// Filename constant
export const GLOBAL_CONFIG_FILENAME = 'rover.json';

/**
 * AI agent enum schema
 */
export const AiAgentSchema = z.enum(AI_AGENT);

/**
 * Telemetry status values
 */
export const TelemetryStatusSchema = z.enum(['enabled', 'disabled']);

/**
 * Attribution status values
 */
export const AttributionStatusSchema = z.enum([
  'enabled',
  'disabled',
  'unknown',
]);

/**
 * Project entry in the global configuration
 */
export const GlobalProjectSchema = z.object({
  /** Unique project identifier */
  id: z.string(),
  /** Absolute path to the project in the local filesystem */
  path: z.string(),
  /** Repository name extracted from the project */
  repositoryName: z.string(),
  /** Detected programming languages in the project */
  languages: z.array(LanguageSchema),
  /** Package managers used in the project */
  packageManagers: z.array(PackageManagerSchema),
  /** Task managers used in the project */
  taskManagers: z.array(TaskManagerSchema),
});

/**
 * Complete global configuration schema
 * Defines the structure of the global config.json file
 */
export const GlobalConfigSchema = z.object({
  /** Schema version for migrations */
  version: z.string(),
  /** Sorted list of AI agents by user preference */
  agents: z.array(AiAgentSchema),
  /** Anonymous user identifier */
  userId: z.string(),
  /** Telemetry status */
  telemetry: TelemetryStatusSchema,
  /** Whether to show attribution in outputs */
  attribution: AttributionStatusSchema,
  /** Timestamp when the configuration was created */
  createdAt: z.iso.datetime(),
  /** Timestamp when the configuration was last updated */
  updatedAt: z.iso.datetime(),
  /** List of projects available in the system */
  projects: z.array(GlobalProjectSchema),
});
