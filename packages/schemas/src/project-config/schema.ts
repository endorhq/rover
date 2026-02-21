/**
 * Zod schemas for runtime validation of project configuration files (rover.json)
 */

import { z } from 'zod';

// Current schema version
export const CURRENT_PROJECT_SCHEMA_VERSION = '1.3';

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
  'dart',
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
  'pub',
]);

/**
 * Supported task managers
 */
export const TaskManagerSchema = z.enum(['just', 'make', 'task']);

/**
 * Network filtering mode
 */
export const NetworkModeSchema = z.enum(['allowlist', 'blocklist', 'allowall']);

/**
 * Network mode values as an array for CLI choices
 */
export const NETWORK_MODE_VALUES = NetworkModeSchema.options;

/**
 * Network rule entry - can be domain name, IP, or CIDR
 */
export const NetworkRuleSchema = z.object({
  /** Host pattern: domain name, IP address, or CIDR notation */
  host: z.string(),
  /** Optional description for documentation */
  description: z.string().optional(),
});

/**
 * Network filtering configuration for container sandboxes
 */
export const NetworkConfigSchema = z.object({
  /** Filtering mode: allowlist (deny all except), blocklist (allow all except), or allowall (no filtering) */
  mode: NetworkModeSchema.default('allowall'),
  /** List of network rules (domains, IPs, or CIDRs) */
  rules: z.array(NetworkRuleSchema).default([]),
  /** Allow DNS resolution (always recommended, defaults to true) */
  allowDns: z.boolean().default(true),
  /** Allow localhost/loopback traffic (defaults to true for MCP servers) */
  allowLocalhost: z.boolean().default(true),
});

/**
 * Sandbox configuration for custom agent images and initialization
 */
export const SandboxConfigSchema = z.object({
  /** Custom Docker/Podman agent image */
  agentImage: z.string().optional(),
  /** Initialization script to run in the container */
  initScript: z.string().optional(),
  /** Extra arguments to pass to the Docker/Podman container */
  extraArgs: z.union([z.string(), z.array(z.string())]).optional(),
  /** Network filtering configuration */
  network: NetworkConfigSchema.optional(),
});

/**
 * Hooks configuration for task lifecycle events
 */
export const HooksConfigSchema = z.object({
  /** Commands to run when a task is merged */
  onMerge: z.array(z.string()).optional(),
  /** Commands to run when a task is pushed */
  onPush: z.array(z.string()).optional(),
  /** Commands to run when a task completes (success or failure) */
  onComplete: z.array(z.string()).optional(),
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
  /** Optional hooks configuration for task lifecycle events */
  hooks: HooksConfigSchema.optional(),
  /** Optional glob patterns for files to exclude from agent context */
  excludePatterns: z.array(z.string()).optional(),
});
