/**
 * Task description types and interfaces.
 * Defines the structure for task metadata and configuration.
 */
import { z } from 'zod';
import {
  TaskStatusSchema,
  TaskDescriptionSchema as TaskDescriptionZodSchema,
} from './schema.js';

// Infer TaskStatus type from Zod schema
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

// Infer TaskDescriptionSchema type from Zod schema
export type TaskDescriptionSchema = z.infer<typeof TaskDescriptionZodSchema>;

// Data required to create a new task
export interface CreateTaskData {
  id: number;
  title: string;
  description: string;
  inputs: Map<string, string>;
  workflowName: string;
  uuid?: string; // Optional, will be generated if not provided
  agent?: string; // AI agent to use for execution
  sourceBranch?: string; // Source branch task was created from
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
