import type { Git } from 'rover-core';

export interface ConflictRegion {
  startLine: number;
  endLine: number;
}

export interface TruncationResult {
  content: string;
  conflictRegions: ConflictRegion[];
}

/**
 * Find all conflict regions in a file's content.
 * Returns line ranges (0-indexed) for each conflict block.
 */
export function findConflictRegions(content: string): ConflictRegion[] {
  const lines = content.split('\n');
  const regions: ConflictRegion[] = [];
  let currentStart: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('<<<<<<<')) {
      currentStart = i;
    } else if (lines[i].startsWith('>>>>>>>') && currentStart !== null) {
      regions.push({ startLine: currentStart, endLine: i });
      currentStart = null;
    }
  }

  return regions;
}

/**
 * Truncate file content to show only context around conflict regions.
 * Keeps `contextLines` lines above and below each conflict.
 * Merges overlapping context windows.
 */
export function truncateConflictContext(
  content: string,
  contextLines: number = 50
): TruncationResult {
  const lines = content.split('\n');
  const regions = findConflictRegions(content);

  if (regions.length === 0) {
    return { content, conflictRegions: regions };
  }

  // Build context windows and merge overlapping ones
  const windows: { start: number; end: number }[] = [];

  for (const region of regions) {
    const windowStart = Math.max(0, region.startLine - contextLines);
    const windowEnd = Math.min(lines.length - 1, region.endLine + contextLines);

    if (
      windows.length > 0 &&
      windowStart <= windows[windows.length - 1].end + 1
    ) {
      // Merge with previous window
      windows[windows.length - 1].end = windowEnd;
    } else {
      windows.push({ start: windowStart, end: windowEnd });
    }
  }

  // Build truncated output
  const outputParts: string[] = [];
  let lastEnd = -1;

  for (const window of windows) {
    if (window.start > lastEnd + 1) {
      const omittedCount = window.start - (lastEnd + 1);
      outputParts.push(`// ... ${omittedCount} lines omitted ...`);
    }

    outputParts.push(lines.slice(window.start, window.end + 1).join('\n'));
    lastEnd = window.end;
  }

  if (lastEnd < lines.length - 1) {
    const omittedCount = lines.length - 1 - lastEnd;
    outputParts.push(`// ... ${omittedCount} lines omitted ...`);
  }

  return {
    content: outputParts.join('\n'),
    conflictRegions: regions,
  };
}

/**
 * Parse AI output that uses the `---REGION N---` format.
 * Returns an array of resolved region strings (one per conflict).
 */
export function parseResolvedRegions(
  aiOutput: string,
  expectedCount: number
): string[] {
  const parts = aiOutput.split(/^---REGION \d+---$/m);
  // First element is anything before the first marker (should be empty/whitespace)
  const regions = parts
    .slice(1)
    .map(p => p.replace(/^\n/, '').replace(/\n$/, ''));

  if (regions.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} resolved region(s) but got ${regions.length}`
    );
  }

  return regions;
}

/**
 * Reconstruct a full file by replacing conflict regions with resolved content.
 * Processes regions in reverse order to preserve line numbers.
 */
export function reconstructFile(
  originalContent: string,
  conflictRegions: ConflictRegion[],
  resolvedRegions: string[]
): string {
  const lines = originalContent.split('\n');

  // Process in reverse so earlier line numbers stay valid
  for (let i = conflictRegions.length - 1; i >= 0; i--) {
    const region = conflictRegions[i];
    const resolved = resolvedRegions[i];
    const resolvedLines = resolved.split('\n');
    // Replace from startLine to endLine (inclusive)
    lines.splice(
      region.startLine,
      region.endLine - region.startLine + 1,
      ...resolvedLines
    );
  }

  return lines.join('\n');
}

/**
 * Strip AI artifacts (markdown fences, trailing markers) only if
 * they weren't present in the original content.
 */
export function sanitizeAIOutput(
  output: string,
  originalContent: string
): string {
  let s = output;

  // Strip wrapping markdown fences only if original didn't have them
  const fenceMatch = s.match(/^```[\w-]*\n?([\s\S]*?)\n?```\s*$/);
  if (fenceMatch && !originalContent.includes('```')) {
    s = fenceMatch[1];
  }

  // Strip trailing ---END--- style markers only if original didn't have them
  const endMarkerMatch = s.match(/\n?---[A-Z_]*END[A-Z_]*---\s*$/i);
  if (endMarkerMatch && !originalContent.includes(endMarkerMatch[0].trim())) {
    s = s.replace(/\n?---[A-Z_]*END[A-Z_]*---\s*$/i, '');
  }

  return s.trim();
}

/** Returns true if content still has conflict markers */
export function hasConflictMarkers(content: string): boolean {
  return /^<{7} |^={7}$|^>{7} /m.test(content);
}

/**
 * Get blame-based commit context for conflict regions.
 * Runs git blame on each conflict region against both sides of the merge/rebase.
 */
export function getBlameContext(
  git: Git,
  filePath: string,
  regions: ConflictRegion[],
  refs: { ours: string; theirs: string },
  worktreePath?: string
): string {
  const allCommits: Map<string, string> = new Map();

  for (const region of regions) {
    // Blame lines are 1-indexed in git
    const startLine = region.startLine + 1;
    const endLine = region.endLine + 1;

    for (const ref of [refs.ours, refs.theirs]) {
      try {
        const commits = git.getBlameCommits(
          filePath,
          startLine,
          endLine,
          ref,
          worktreePath
        );
        for (const commit of commits) {
          allCommits.set(commit.hash, commit.summary);
        }
      } catch {
        // Blame may fail if file doesn't exist on that ref
      }
    }
  }

  if (allCommits.size === 0) {
    return '';
  }

  return Array.from(allCommits.values())
    .map(summary => `- ${summary}`)
    .join('\n');
}
