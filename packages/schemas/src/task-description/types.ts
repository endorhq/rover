/**
 * Task description types and interfaces.
 * Defines the structure for task metadata and configuration.
 */
import { z } from 'zod';
import { TaskStatusSchema, TaskDescriptionSchema } from './schema.js';
import { type NetworkConfig } from '../project-config/types.js';

// Infer TaskStatus type from Zod schema
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// Infer TaskDescriptionSchema type from Zod schema
export type TaskDescription = z.infer<typeof TaskDescriptionSchema>;

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
