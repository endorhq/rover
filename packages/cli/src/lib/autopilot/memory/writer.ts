import type { ActionTrace, Span } from '../types.js';
import type { AutopilotStore } from '../store.js';
import type { MemoryStore } from './store.js';

export interface MemoryEntry {
  timestamp: string;
  eventType: string;
  eventSummary: string;
  traceId: string;
  decision: string;
  outcome: string;
  filesChanged: string[];
  prUrl: string | null;
}

/**
 * Build a MemoryEntry from a completed trace by extracting data from spans.
 */
export function buildMemoryEntry(
  trace: ActionTrace,
  spans: Span[],
  store: AutopilotStore,
  extra?: { decision?: string; prUrl?: string }
): MemoryEntry {
  const now = new Date();
  const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // Extract event type and summary from the root span
  const rootSpan = spans.find(s => s.parent === null);
  const eventType = (rootSpan?.meta?.type as string) ?? 'unknown';
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

  // Build event summary line
  let eventSummary = eventType;
  if (eventAction) eventSummary += ` (${eventAction})`;
  if (eventNumber) eventSummary = `${eventSummary}`;

  // Extract decision from the coordinator span
  const coordinatorSpan = spans.find(s => s.step === 'coordinate');
  const decision =
    extra?.decision ?? (coordinatorSpan?.meta?.action as string) ?? 'unknown';

  // Extract outcome from trace steps
  const completedSteps = trace.steps.filter(s => s.status === 'completed');
  const failedSteps = trace.steps.filter(s => s.status === 'failed');
  let outcome = `${completedSteps.length} step(s) completed`;
  if (failedSteps.length > 0) {
    outcome += `, ${failedSteps.length} failed`;
  }

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

  // Extract PR URL from push spans or extra
  let prUrl = extra?.prUrl ?? null;
  if (!prUrl) {
    for (const step of trace.steps) {
      if (step.action === 'push' && step.spanId) {
        const pushSpan = store.readSpan(step.spanId);
        if (pushSpan?.meta?.pullRequestUrl) {
          prUrl = pushSpan.meta.pullRequestUrl as string;
          break;
        }
      }
    }
  }

  // Extract branch name from task mappings
  const taskMappings = store.getAllTaskMappings();
  let branchName: string | null = null;
  for (const step of trace.steps) {
    const mapping = taskMappings[step.actionId];
    if (mapping?.branchName) {
      branchName = mapping.branchName;
      break;
    }
  }

  if (branchName) {
    outcome += `, committed on branch ${branchName}`;
  }

  return {
    timestamp,
    eventType,
    eventSummary: eventNumber
      ? `${eventAction} #${eventNumber} "${eventTitle}"`
      : `${eventAction} "${eventTitle}"`,
    traceId: trace.traceId,
    decision,
    outcome,
    filesChanged,
    prUrl,
  };
}

/**
 * Format a MemoryEntry as a markdown section for the daily log.
 */
function formatDailyEntry(entry: MemoryEntry): string {
  let md = `## [${entry.timestamp}] ${entry.eventSummary} → ${entry.decision}\n\n`;
  md += `- **Trace**: ${entry.traceId}\n`;
  md += `- **Event**: ${entry.eventType}\n`;
  md += `- **Decision**: ${entry.decision}\n`;
  md += `- **Outcome**: ${entry.outcome}\n`;

  if (entry.filesChanged.length > 0) {
    md += `- **Files changed**: ${entry.filesChanged.join(', ')}\n`;
  }

  if (entry.prUrl) {
    md += `- **PR**: ${entry.prUrl}\n`;
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
  extra?: { decision?: string; prUrl?: string }
): Promise<void> {
  if (!memoryStore) return;

  const entry = buildMemoryEntry(trace, spans, store, extra);
  const formatted = formatDailyEntry(entry);

  memoryStore.appendDailyEntry(formatted);
  await memoryStore.triggerEmbed();
}
