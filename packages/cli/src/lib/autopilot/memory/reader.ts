import type { Span } from '../types.js';
import type { MemoryStore, MemorySearchResult } from './store.js';

const MAX_MEMORY_CHARS = 4000;

/**
 * Build a search query for the coordinator step.
 * Focuses on event type and key identifiers.
 */
export function buildCoordinatorQuery(meta: Record<string, any>): string {
  const parts: string[] = [];

  const eventType = meta.type as string | undefined;
  if (eventType) parts.push(eventType);

  const action = meta.action as string | undefined;
  if (action) parts.push(action);

  const number =
    (meta.issueNumber as number) ?? (meta.prNumber as number) ?? null;
  if (number) parts.push(`#${number}`);

  const title =
    (meta.title as string) ??
    (meta.issueTitle as string) ??
    (meta.prTitle as string);
  if (title) parts.push(title);

  return parts.join(' ') || 'recent activity';
}

/**
 * Build a search query for the planner step.
 * Includes scope details and file context from spans.
 */
export function buildPlannerQuery(
  meta: Record<string, any>,
  spans: Span[]
): string {
  const parts: string[] = [];

  // Extract scope from planner meta
  const scope = meta.scope as string | undefined;
  if (scope) parts.push(scope);

  // Extract key identifiers from the root span
  const rootSpan = spans.find(s => s.parent === null);
  if (rootSpan?.meta) {
    const title =
      (rootSpan.meta.title as string) ??
      (rootSpan.meta.issueTitle as string) ??
      (rootSpan.meta.prTitle as string);
    if (title && !parts.includes(title)) parts.push(title);
  }

  // Add any file paths mentioned in coordinator decision
  const coordinatorSpan = spans.find(s => s.step === 'coordinate');
  if (coordinatorSpan?.meta?.scope) {
    const coordScope = coordinatorSpan.meta.scope as string;
    if (!parts.includes(coordScope)) parts.push(coordScope);
  }

  return parts.join(' ') || 'implementation plan';
}

/**
 * Build a search query for the resolver step.
 * Focuses on failure context and task details.
 */
export function buildResolverQuery(
  trace: {
    summary: string;
    steps: Array<{ action: string; status: string; reasoning?: string }>;
  },
  failedStepDetails: Array<Record<string, any>>
): string {
  const parts: string[] = [];

  // Add trace summary
  if (trace.summary) parts.push(trace.summary);

  // Add failure details
  for (const detail of failedStepDetails.slice(0, 2)) {
    if (detail.task_title) parts.push(detail.task_title);
    if (detail.error) {
      // Take first line of error
      const firstLine = String(detail.error).split('\n')[0].slice(0, 100);
      parts.push(`failure: ${firstLine}`);
    }
  }

  return parts.join(' ') || 'task failure resolution';
}

/**
 * Format search results as a markdown section for prompt injection.
 * Returns empty string if no results found.
 */
function formatResults(results: MemorySearchResult[]): string {
  if (results.length === 0) return '';

  let content = '';
  let charCount = 0;

  for (const result of results) {
    const entry = result.content.trim();
    if (!entry) continue;

    // Respect token budget
    if (charCount + entry.length > MAX_MEMORY_CHARS) {
      // Add truncated version if we have room for at least 200 chars
      const remaining = MAX_MEMORY_CHARS - charCount;
      if (remaining > 200) {
        content += entry.slice(0, remaining) + '\n...(truncated)\n\n';
      }
      break;
    }

    content += entry + '\n\n';
    charCount += entry.length;
  }

  return content;
}

/**
 * Fetch memory context from the store and format it for prompt injection.
 * Returns an object with the formatted content and result count.
 */
export async function fetchMemoryContext(
  store: MemoryStore | undefined,
  query: string,
  max = 5
): Promise<{ content: string; count: number }> {
  if (!store) return { content: '', count: 0 };

  const results = await store.search(query, max);
  if (results.length === 0) return { content: '', count: 0 };

  const formatted = formatResults(results);
  if (!formatted) return { content: '', count: 0 };

  let section = '## Memory (Past Activity)\n\n';
  section +=
    'The following entries are from past autopilot activity on this project. ';
  section +=
    'Use them to avoid repeating past decisions, learn from previous outcomes, ';
  section += 'and recognize patterns.\n\n';
  section += formatted;

  return { content: section, count: results.length };
}
