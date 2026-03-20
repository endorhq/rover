/**
 * Usage reporting types for tracking token consumption and cost
 * across ACP invocations, steps, and workflows.
 */

/**
 * A snapshot of resource usage from a single ACP invocation or
 * an accumulation across multiple invocations.
 */
export interface UsageReport {
  /** Number of input tokens consumed. */
  inputTokens?: number;
  /** Number of output tokens produced. */
  outputTokens?: number;
  /** Total tokens (input + output + cached). */
  totalTokens?: number;
  /** Monetary cost incurred. */
  cost?: number;
  /** Currency of the cost value (default: USD). */
  currency?: string;
  /** Model identifier used. */
  model?: string;
}
