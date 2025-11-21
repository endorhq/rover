/**
 * Zod schemas for runtime validation of project configuration files (rover.json)
 */

import { z } from 'zod';

// Current schema version
export const CURRENT_PROJECT_SCHEMA_VERSION = '1.2';

// Filename constant
export const PROJECT_CONFIG_FILENAME = 'rover.json';

/**
 * Supported programming languages
 */
export const LanguageSchema = z.enum([
  'javascript',
  'typescript',
  'php',
  'rust',
  'go',
  'python',
  'ruby',
]);

/**
 * MCP (Model Context Protocol) configuration
 */
export const MCPSchema = z.object({
  /** MCP server name */
  name: z.string(),
  /** Command or URL to connect to the MCP server */
  commandOrUrl: z.string(),
  /** Transport protocol */
  transport: z.string(),
  /** Optional environment variables */
  envs: z.array(z.string()).optional(),
  /** Optional HTTP headers */
  headers: z.array(z.string()).optional(),
});

/**
 * Supported package managers
 */
export const PackageManagerSchema = z.enum([
  'pnpm',
  'npm',
  'yarn',
  'composer',
  'cargo',
  'gomod',
  'pip',
  'poetry',
  'uv',
  'rubygems',
]);

/**
 * Supported task managers
 */
export const TaskManagerSchema = z.enum(['just', 'make', 'task']);

/**
 * Sandbox configuration for custom agent images and initialization
 */
export const SandboxConfigSchema = z.object({
  /** Custom Docker/Podman agent image */
  agentImage: z.string().optional(),
  /** Initialization script to run in the container */
  initScript: z.string().optional(),
});

/**
 * Complete project configuration schema
 * Defines the structure of a rover.json file
 */
export const ProjectConfigSchema = z.object({
  /** Schema version for migrations */
  version: z.string(),
  /** Supported programming languages in the project */
  languages: z.array(LanguageSchema),
  /** MCP server configurations */
  mcps: z.array(MCPSchema),
  /** Package managers used in the project */
  packageManagers: z.array(PackageManagerSchema),
  /** Task managers used in the project */
  taskManagers: z.array(TaskManagerSchema),
  /** Whether to show attribution in outputs */
  attribution: z.boolean(),
  /** Optional custom environment variables */
  envs: z.array(z.string()).optional(),
  /** Optional path to environment variables file */
  envsFile: z.string().optional(),
  /** Optional sandbox configuration */
  sandbox: SandboxConfigSchema.optional(),
});
