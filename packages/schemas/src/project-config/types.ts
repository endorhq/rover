/**
 * TypeScript types inferred from Zod schemas
 */

import { z } from 'zod';
import {
  LanguageSchema,
  MCPSchema,
  PackageManagerSchema,
  TaskManagerSchema,
  SandboxConfigSchema,
  ProjectConfigSchema,
} from './schema.js';

// Inferred types from Zod schemas
export type Language = z.infer<typeof LanguageSchema>;
export type MCP = z.infer<typeof MCPSchema>;
export type PackageManager = z.infer<typeof PackageManagerSchema>;
export type TaskManager = z.infer<typeof TaskManagerSchema>;
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
