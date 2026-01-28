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
