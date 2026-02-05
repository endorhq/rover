/**
 * Task description types and interfaces.
 * Defines the structure for task metadata and configuration.
 */
import type { z } from 'zod';
import type { TaskStatusSchema, TaskDescriptionSchema } from './schema.js';
import type { NetworkConfig } from '../project-config/types.js';

// Infer TaskStatus type from Zod schema
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// Infer TaskDescriptionSchema type from Zod schema
export type TaskDescription = z.infer<typeof TaskDescriptionSchema>;

/**
 * Source types for task origin tracking.
 * @deprecated Use iteration context instead. Will be removed in a future version.
 */
export type SourceType = 'github' | 'manual';

/**
 * Task source - tracks where a task originated from.
 * @deprecated Use iteration context instead. Will be removed in a future version.
 * Task origin is now tracked via context entries in the iteration schema.
 */
export interface TaskSource {
  type: SourceType; // Source type: 'github', 'manual', etc.
  id?: string; // Source-specific identifier (e.g., "123", "ENG-123")
  url?: string; // Human-readable URL for the source
  title?: string; // Human-readable title/context
  ref?: Record<string, unknown>; // Source-specific data for API calls
}

// Data required to create a new task
export interface CreateTaskData {
  id: number;
  title: string;
  description: string;
  inputs: Map<string, string>;
  workflowName: string;
  uuid?: string; // Optional, will be generated if not provided
  agent?: string; // AI agent to use for execution
  agentModel?: string; // AI model to use (e.g., opus, sonnet, flash)
  sourceBranch?: string; // Source branch task was created from
  networkConfig?: NetworkConfig; // Network filtering config (overrides project config)
  source?: TaskSource; // Source of the task (github, manual, etc.)
}

// Metadata for status updates
export interface StatusMetadata {
  timestamp?: string;
  error?: string;
}

// Metadata for iteration updates
export interface IterationMetadata {
  title?: string;
  description?: string;
  timestamp?: string;
}
