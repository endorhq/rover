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
  uuid: z.string().uuid(),
  title: z.string().min(1),
  description: z.string(),

  // List of inputs for the workflow
  inputs: z.record(z.string(), z.string()),

  // Status & Lifecycle
  status: TaskStatusSchema,
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  failedAt: z.string().datetime().optional(),
  lastIterationAt: z.string().datetime().optional(),
  lastStatusCheck: z.string().datetime().optional(),

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
  runningAt: z.string().datetime().optional(),
  errorAt: z.string().datetime().optional(),
  exitCode: z.number().int().optional(),

  // Error Handling
  error: z.string().optional(),

  // Restart Tracking
  restartCount: z.number().int().min(0).optional(),
  lastRestartAt: z.string().datetime().optional(),

  // Metadata
  version: z.string(),
});
