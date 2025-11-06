/**
 * Task description Zod schemas for validation.
 * Defines validation rules for task description data.
 */
import { z } from 'zod';

// Schema version for migrations
export const CURRENT_TASK_DESCRIPTION_SCHEMA_VERSION = '1.1';

// Task status schema
export const TaskStatusSchema = z.enum([
  'NEW',
  'IN_PROGRESS',
  'ITERATING',
  'COMPLETED',
  'FAILED',
  'MERGED',
  'PUSHED',
]);

// Task description schema
export const TaskDescriptionSchema = z.object({
  // Core Identity
  id: z.number().int().positive(),
  uuid: z.uuid(),
  title: z.string().min(1),
  description: z.string(),

  // List of inputs for the workflow
  inputs: z.record(z.string(), z.string()),

  // Status & Lifecycle
  status: TaskStatusSchema,
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  completedAt: z.iso.datetime().optional(),
  failedAt: z.iso.datetime().optional(),
  lastIterationAt: z.iso.datetime().optional(),
  lastStatusCheck: z.iso.datetime().optional(),

  // Execution Context
  iterations: z.number().int().min(1),
  workflowName: z.string().min(1),
  worktreePath: z.string(),
  branchName: z.string(),
  agent: z.string().optional(),
  sourceBranch: z.string().optional(),

  // Docker Execution
  containerId: z.string().optional(),
  executionStatus: z.string().optional(),
  runningAt: z.iso.datetime().optional(),
  errorAt: z.iso.datetime().optional(),
  exitCode: z.number().int().optional(),

  // Error Handling
  error: z.string().optional(),

  // Restart Tracking
  restartCount: z.number().int().min(0).optional(),
  lastRestartAt: z.iso.datetime().optional(),

  // Metadata
  version: z.string(),
});
