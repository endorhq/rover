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
 * Accumulates UsageReport entries across multiple operations.
 *
 * Useful for tracking total cost/tokens at the step level
 * (multiple prompts per step) and at the workflow level
 * (multiple steps per workflow).
 *
 * Token counts and costs are summed. The model field retains the
 * last recorded value (since a step may use multiple models, the
 * caller can inspect individual reports if needed).
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
    let model: string | undefined;

    let hasTokens = false;
    let hasCost = false;

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
        model = report.model;
      }
    }

    return {
      inputTokens: hasTokens ? inputTokens : undefined,
      outputTokens: hasTokens ? outputTokens : undefined,
      totalTokens: hasTokens ? totalTokens : undefined,
      cost: hasCost ? cost : undefined,
      currency: hasCost ? (currency ?? 'USD') : undefined,
      model,
    };
  }

  /** Reset all recorded reports. */
  reset(): void {
    this.reports = [];
  }
}
