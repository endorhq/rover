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
 * Generate the index.md content for context entries.
 *
 * @param entries - All context entries for this iteration
 * @param iterationNumber - Current iteration number
 * @returns Markdown content for index.md
 */
export function generateContextIndex(
  entries: IterationContextEntry[],
  iterationNumber: number
): string {
  const lines: string[] = [];

  lines.push(`# Context for Iteration ${iterationNumber}`);
  lines.push('');

  if (entries.length === 0) {
    lines.push('No context sources were provided for this iteration.');
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
