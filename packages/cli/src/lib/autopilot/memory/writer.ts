import type { ActionTrace, Span } from '../types.js';
import type { AutopilotStore } from '../store.js';
import type { MemoryStore } from './store.js';

export interface MemoryEntry {
  timestamp: string;
  eventSummary: string;
  traceId: string;
  summary: string | null;
  filesChanged: string[];
  url: string | null;
}

/**
 * Build a MemoryEntry from a completed trace by extracting data from spans.
 */
export function buildMemoryEntry(
  trace: ActionTrace,
  spans: Span[],
  store: AutopilotStore,
  extra?: { prUrl?: string; summary?: string }
): MemoryEntry {
  const now = new Date();
  const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // Extract event type and summary from the root span
  const rootSpan = spans.find(s => s.parent === null);
  const eventAction = (rootSpan?.meta?.action as string) ?? '';
  const eventNumber =
    (rootSpan?.meta?.issueNumber as number) ??
    (rootSpan?.meta?.prNumber as number) ??
    null;
  const eventTitle =
    (rootSpan?.meta?.title as string) ??
    (rootSpan?.meta?.issueTitle as string) ??
    (rootSpan?.meta?.prTitle as string) ??
    trace.summary;

  // Extract URL from the root event span
  const url = (rootSpan?.meta?.url as string) ?? null;

  // Chain summary from the terminal step (summarizer or notify)
  const summary = extra?.summary ?? null;

  // Extract files changed from commit spans
  const filesChanged: string[] = [];
  for (const step of trace.steps) {
    if (step.action === 'commit' && step.spanId) {
      const commitSpan = store.readSpan(step.spanId);
      if (commitSpan?.meta?.filesChanged) {
        const files = commitSpan.meta.filesChanged;
        if (Array.isArray(files)) {
          filesChanged.push(...files);
        }
      }
    }
  }

  // Resolve reference URL: prefer PR URL from push spans, fall back to
  // the root event span's URL (issue or PR html_url).
  let referenceUrl = extra?.prUrl ?? null;
  if (!referenceUrl) {
    for (const step of trace.steps) {
      if (step.action === 'push' && step.spanId) {
        const pushSpan = store.readSpan(step.spanId);
        if (pushSpan?.meta?.pullRequestUrl) {
          referenceUrl = pushSpan.meta.pullRequestUrl as string;
          break;
        }
      }
    }
  }
  if (!referenceUrl) {
    referenceUrl = url;
  }

  return {
    timestamp,
    eventSummary: eventNumber
      ? `${eventAction} #${eventNumber} "${eventTitle}"`
      : `${eventAction} "${eventTitle}"`,
    traceId: trace.traceId,
    summary,
    filesChanged,
    url: referenceUrl,
  };
}

/**
 * Format a MemoryEntry as a markdown section for the daily log.
 */
function formatDailyEntry(entry: MemoryEntry): string {
  let md = `## [${entry.timestamp}] ${entry.eventSummary}\n\n`;

  if (entry.summary) {
    md += `${entry.summary}\n\n`;
  }

  md += `- **Trace**: ${entry.traceId}\n`;

  if (entry.filesChanged.length > 0) {
    md += `- **Files changed**: ${entry.filesChanged.join(', ')}\n`;
  }

  if (entry.url) {
    md += `- **Reference**: ${entry.url}\n`;
  }

  md += '\n---\n';
  return md;
}

/**
 * Record a trace completion in the daily memory log.
 * Called from terminal steps (noop, notify).
 */
export async function recordTraceCompletion(
  memoryStore: MemoryStore | undefined,
  trace: ActionTrace,
  spans: Span[],
  store: AutopilotStore,
  extra?: { prUrl?: string; summary?: string }
): Promise<void> {
  if (!memoryStore) return;

  const entry = buildMemoryEntry(trace, spans, store, extra);
  const formatted = formatDailyEntry(entry);

  memoryStore.appendDailyEntry(formatted);
  await memoryStore.update();
}
