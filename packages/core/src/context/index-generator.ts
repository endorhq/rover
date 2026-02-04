/**
 * Context Index Generator - Generates the index.md manifest for context entries.
 *
 * The index.md file provides a human-readable overview of all context sources
 * for an iteration, categorized by:
 * - New in this iteration
 * - Updated in this iteration (re-fetched)
 * - From previous iterations (inherited)
 */
import type { IterationContextEntry } from 'rover-schemas';

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
  const lines: string[] = [];

  lines.push(`# Context for Iteration ${iterationNumber}`);
  lines.push('');

  const hasArtifacts =
    (options?.iterationSummaries?.length ?? 0) > 0 ||
    (options?.iterationPlans?.length ?? 0) > 0;

  if (entries.length === 0 && !hasArtifacts) {
    lines.push('No context sources were provided for this iteration.');
    return lines.join('\n');
  }

  // Previous iteration summaries
  if (options?.iterationSummaries && options.iterationSummaries.length > 0) {
    lines.push('## Previous Iteration Summaries');
    lines.push('');
    for (const summary of options.iterationSummaries) {
      lines.push(`### Iteration ${summary.iteration}`);
      lines.push('');
      lines.push(summary.content);
      lines.push('');
    }
  }

  // Iteration plans
  if (options?.iterationPlans && options.iterationPlans.length > 0) {
    lines.push('## Iteration Plans');
    for (const plan of options.iterationPlans) {
      lines.push(`- \`${plan.file}\`: Plan from iteration ${plan.iteration}`);
    }
    lines.push('');
  }

  if (entries.length === 0) {
    return lines.join('\n');
  }

  // Categorize entries
  const newEntries: IterationContextEntry[] = [];
  const updatedEntries: IterationContextEntry[] = [];
  const inheritedEntries: IterationContextEntry[] = [];

  for (const entry of entries) {
    if (entry.provenance.addedIn === iterationNumber) {
      // Newly added in this iteration
      newEntries.push(entry);
    } else if (entry.provenance.updatedIn === iterationNumber) {
      // Re-fetched/updated in this iteration
      updatedEntries.push(entry);
    } else {
      // Inherited from previous iteration
      inheritedEntries.push(entry);
    }
  }

  // New entries section
  if (newEntries.length > 0) {
    lines.push('## New in this iteration');
    for (const entry of newEntries) {
      lines.push(
        `- **${entry.name}** (\`${entry.file}\`) - ${entry.description}`
      );
    }
    lines.push('');
  }

  // Updated entries section
  if (updatedEntries.length > 0) {
    lines.push('## Updated in this iteration');
    for (const entry of updatedEntries) {
      lines.push(
        `- **${entry.name}** (\`${entry.file}\`) - ${entry.description}, originally added in iteration ${entry.provenance.addedIn}`
      );
    }
    lines.push('');
  }

  // Inherited entries section
  if (inheritedEntries.length > 0) {
    lines.push('## From previous iterations');
    for (const entry of inheritedEntries) {
      lines.push(
        `- **${entry.name}** (\`${entry.file}\`) - added in iteration ${entry.provenance.addedIn}`
      );
    }
    lines.push('');
  }

  // Detailed sources section
  lines.push('## Sources');
  lines.push('');

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
  } else if (provenance.addedIn === currentIteration) {
    return `added in iteration ${provenance.addedIn}`;
  } else {
    return `added in iteration ${provenance.addedIn}`;
  }
}
