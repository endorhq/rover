/**
 * Usage reporting types and utilities for tracking token consumption
 * and cost across operations (agent invocations, commit message
 * generation, conflict resolution, etc.).
 */

import type { UsageReport } from 'rover-schemas';

/**
 * Result of an operation that may report usage metrics,
 * pairing a text response with optional usage data.
 */
export interface InvokeResult {
  /** The text response. */
  response: string;
  /** Usage metrics reported by the operation, if available. */
  usage?: UsageReport;
}

/**
 * Generic wrapper that pairs any result value with optional usage metrics.
 *
 * Used by higher-level methods (task expansion, commit message generation, etc.)
 * that process the raw agent response but still want to surface cost/token data.
 */
export interface ResultWithUsage<T> {
  /** The processed result. */
  result: T;
  /** Usage metrics reported by the underlying invocation, if available. */
  usage?: UsageReport;
}

/**
 * Accumulates UsageReport entries across multiple operations.
 *
 * Useful for tracking total cost/tokens at the step level
 * (multiple prompts per step) and at the workflow level
 * (multiple steps per workflow).
 *
 * Token counts and costs are summed. Top-level `agent` and `model`
 * are set only when every recorded report used the same value.
 */
export class UsageTracker {
  private reports: UsageReport[] = [];

  /** Record a single usage report. No-ops if report is undefined. */
  record(report: UsageReport | undefined): void {
    if (!report) return;
    this.reports.push(report);
  }

  /** Return all individual reports recorded so far. */
  get entries(): readonly UsageReport[] {
    return this.reports;
  }

  /** Whether any usage has been recorded. */
  get hasUsage(): boolean {
    return this.reports.length > 0;
  }

  /**
   * Compute the aggregated usage across all recorded reports.
   * Returns undefined if no reports have been recorded.
   */
  get total(): UsageReport | undefined {
    if (this.reports.length === 0) return undefined;

    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let cost = 0;
    let currency: string | undefined;

    let hasTokens = false;
    let hasCost = false;

    const models = new Set<string>();
    const agents = new Set<string>();

    for (const report of this.reports) {
      if (report.inputTokens !== undefined) {
        inputTokens += report.inputTokens;
        hasTokens = true;
      }
      if (report.outputTokens !== undefined) {
        outputTokens += report.outputTokens;
        hasTokens = true;
      }
      if (report.totalTokens !== undefined) {
        totalTokens += report.totalTokens;
        hasTokens = true;
      }
      if (report.cost !== undefined) {
        cost += report.cost;
        hasCost = true;
      }
      if (report.currency !== undefined) {
        currency = report.currency;
      }
      if (report.model !== undefined) {
        models.add(report.model);
      }
      if (report.agent !== undefined) {
        agents.add(report.agent);
      }
    }

    return {
      inputTokens: hasTokens ? inputTokens : undefined,
      outputTokens: hasTokens ? outputTokens : undefined,
      totalTokens: hasTokens ? totalTokens : undefined,
      cost: hasCost ? cost : undefined,
      currency: hasCost ? (currency ?? 'USD') : undefined,
      agent: agents.size === 1 ? [...agents][0] : undefined,
      model: models.size === 1 ? [...models][0] : undefined,
    };
  }

  /** Reset all recorded reports. */
  reset(): void {
    this.reports = [];
  }
}
