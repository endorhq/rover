/**
 * Usage reporting types for tracking token consumption and cost
 * across ACP invocations, steps, and workflows.
 *
 * All types are inferred from Zod schemas to ensure consistency.
 */

import type { z } from 'zod';
import type { UsageReportSchema, StepUsageReportSchema } from './schema.js';

/**
 * Aggregated usage across all steps, with optional per-step breakdown.
 * Top-level `agent` and `model` are populated only when every step
 * used the same value.
 */
export type UsageReport = z.infer<typeof UsageReportSchema>;

/**
 * Usage report for a single workflow step.
 */
export type StepUsageReport = z.infer<typeof StepUsageReportSchema>;
