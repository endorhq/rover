/**
 * TypeScript types inferred from Zod schemas
 */

import { z } from 'zod';
import {
  LanguageSchema,
  MCPSchema,
  PackageManagerSchema,
  TaskManagerSchema,
  NetworkModeSchema,
  NetworkRuleSchema,
  NetworkConfigSchema,
  SandboxConfigSchema,
  HooksConfigSchema,
  ProjectConfigSchema,
} from './schema.js';

// Inferred types from Zod schemas
export type Language = z.infer<typeof LanguageSchema>;
export type MCP = z.infer<typeof MCPSchema>;
export type PackageManager = z.infer<typeof PackageManagerSchema>;
export type TaskManager = z.infer<typeof TaskManagerSchema>;
export type NetworkMode = z.infer<typeof NetworkModeSchema>;
export type NetworkRule = z.infer<typeof NetworkRuleSchema>;
export type NetworkConfig = z.infer<typeof NetworkConfigSchema>;
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;
export type HooksConfig = z.infer<typeof HooksConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
