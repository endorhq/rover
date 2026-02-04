/**
 * Context Index Generator - Generates the index.md manifest for context entries.
 *
 * The index.md file provides a human-readable overview of all context sources
 * for an iteration, categorized by:
 * - New in this iteration
 * - Updated in this iteration (re-fetched)
 * - From previous iterations (inherited)
 */
import pupa from 'pupa';
import type { IterationContextEntry } from 'rover-schemas';
import TEMPLATE from './templates/context-index.md';
import EMPTY_TEMPLATE from './templates/context-index-empty.md';

/**
 * Options for generating the context index with iteration artifacts.
 */
export interface ContextIndexOptions {
  /** Summaries from previous iterations, ordered by iteration number */
  iterationSummaries?: Array<{ iteration: number; content: string }>;
  /** Plan files from previous iterations */
  iterationPlans?: Array<{ iteration: number; file: string }>;
}

/**
 * Generate the index.md content for context entries.
 *
 * @param entries - All context entries for this iteration
 * @param iterationNumber - Current iteration number
 * @param options - Optional iteration artifacts (summaries and plans)
 * @returns Markdown content for index.md
 */
export function generateContextIndex(
  entries: IterationContextEntry[],
  iterationNumber: number,
  options?: ContextIndexOptions
): string {
  const hasArtifacts =
    (options?.iterationSummaries?.length ?? 0) > 0 ||
    (options?.iterationPlans?.length ?? 0) > 0;

  if (entries.length === 0 && !hasArtifacts) {
    return pupa(EMPTY_TEMPLATE, { iterationNumber }, { ignoreMissing: true });
  }

  // Categorize entries
  const newEntries: IterationContextEntry[] = [];
  const updatedEntries: IterationContextEntry[] = [];
  const inheritedEntries: IterationContextEntry[] = [];

  for (const entry of entries) {
    if (entry.provenance.addedIn === iterationNumber) {
      newEntries.push(entry);
    } else if (entry.provenance.updatedIn === iterationNumber) {
      updatedEntries.push(entry);
    } else {
      inheritedEntries.push(entry);
    }
  }

  // Pre-compute each section
  const summariesSection = buildSummariesSection(
    options?.iterationSummaries ?? []
  );
  const plansSection = buildPlansSection(options?.iterationPlans ?? []);
  const newEntriesSection = buildNewEntriesSection(newEntries);
  const updatedEntriesSection = buildUpdatedEntriesSection(updatedEntries);
  const inheritedEntriesSection =
    buildInheritedEntriesSection(inheritedEntries);
  const sourcesSection =
    entries.length > 0 ? buildSourcesSection(entries, iterationNumber) : '';

  return pupa(
    TEMPLATE,
    {
      iterationNumber,
      summariesSection,
      plansSection,
      newEntriesSection,
      updatedEntriesSection,
      inheritedEntriesSection,
      sourcesSection,
    },
    { ignoreMissing: true }
  );
}

/**
 * Build the "Previous Iteration Summaries" section.
 */
function buildSummariesSection(
  summaries: Array<{ iteration: number; content: string }>
): string {
  if (summaries.length === 0) return '';

  const lines: string[] = ['## Previous Iteration Summaries', ''];
  for (const summary of summaries) {
    lines.push(`### Iteration ${summary.iteration}`, '', summary.content, '');
  }
  return lines.join('\n');
}

/**
 * Build the "Iteration Plans" section.
 */
function buildPlansSection(
  plans: Array<{ iteration: number; file: string }>
): string {
  if (plans.length === 0) return '';

  const lines: string[] = ['## Iteration Plans'];
  for (const plan of plans) {
    lines.push(`- \`${plan.file}\`: Plan from iteration ${plan.iteration}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Build the "New in this iteration" section.
 */
function buildNewEntriesSection(entries: IterationContextEntry[]): string {
  if (entries.length === 0) return '';

  const lines: string[] = ['## New in this iteration'];
  for (const entry of entries) {
    lines.push(
      `- **${entry.name}** (\`${entry.file}\`) - ${entry.description}`
    );
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Build the "Updated in this iteration" section.
 */
function buildUpdatedEntriesSection(entries: IterationContextEntry[]): string {
  if (entries.length === 0) return '';

  const lines: string[] = ['## Updated in this iteration'];
  for (const entry of entries) {
    lines.push(
      `- **${entry.name}** (\`${entry.file}\`) - ${entry.description}, originally added in iteration ${entry.provenance.addedIn}`
    );
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Build the "From previous iterations" section.
 */
function buildInheritedEntriesSection(
  entries: IterationContextEntry[]
): string {
  if (entries.length === 0) return '';

  const lines: string[] = ['## From previous iterations'];
  for (const entry of entries) {
    lines.push(
      `- **${entry.name}** (\`${entry.file}\`) - added in iteration ${entry.provenance.addedIn}`
    );
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Build the detailed "Sources" section.
 */
function buildSourcesSection(
  entries: IterationContextEntry[],
  iterationNumber: number
): string {
  const lines: string[] = ['## Sources', ''];

  for (const entry of entries) {
    lines.push(`### ${entry.name}`);
    lines.push(`- **File:** ${entry.file}`);
    lines.push(`- **URI:** ${entry.uri}`);

    if (entry.metadata?.type) {
      lines.push(`- **Type:** ${entry.metadata.type}`);
    }

    lines.push(`- **Fetched:** ${entry.fetchedAt}`);
    lines.push(
      `- **Provenance:** ${formatProvenance(entry.provenance, iterationNumber)}`
    );
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format provenance information for display.
 */
function formatProvenance(
  provenance: IterationContextEntry['provenance'],
  currentIteration: number
): string {
  if (provenance.updatedIn === currentIteration) {
    return `added in iteration ${provenance.addedIn}, updated in iteration ${provenance.updatedIn}`;
  }
  return `added in iteration ${provenance.addedIn}`;
}
