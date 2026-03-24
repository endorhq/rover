/**
 * Zod schema for runtime validation of usage reports.
 */

import { z } from 'zod';

/**
 * Schema for a single step's usage report within an iteration.
 */
export const StepUsageReportSchema = z.object({
  /** Step identifier. */
  stepId: z.string(),
  /** Number of input tokens consumed. */
  inputTokens: z.number().optional(),
  /** Number of output tokens produced. */
  outputTokens: z.number().optional(),
  /** Total tokens (input + output + cached). */
  totalTokens: z.number().optional(),
  /** Monetary cost incurred. */
  cost: z.number().optional(),
  /** Currency of the cost value (default: USD). */
  currency: z.string().optional(),
  /** Agent tool used (e.g. "claude", "gemini"). */
  agent: z.string().optional(),
  /** Model identifier used. */
  model: z.string().optional(),
});

/**
 * Schema for aggregated usage/cost attached to an iteration or task.
 * Contains totals across all steps, with an optional per-step breakdown.
 */
export const UsageReportSchema = z.object({
  /** Number of input tokens consumed. */
  inputTokens: z.number().optional(),
  /** Number of output tokens produced. */
  outputTokens: z.number().optional(),
  /** Total tokens (input + output + cached). */
  totalTokens: z.number().optional(),
  /** Monetary cost incurred. */
  cost: z.number().optional(),
  /** Currency of the cost value (default: USD). */
  currency: z.string().optional(),
  /** Agent tool — set only when all steps used the same agent. */
  agent: z.string().optional(),
  /** Model identifier — set only when all steps used the same model. */
  model: z.string().optional(),
  /** Per-step usage breakdown. */
  steps: z.array(StepUsageReportSchema).optional(),
});
