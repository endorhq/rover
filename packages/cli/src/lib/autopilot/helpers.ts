import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { getProjectPath } from 'rover-core';

/**
 * Ensures the spans/ and actions/ directories exist for a project.
 * Call once at autopilot startup — individual SpanWriter / ActionWriter
 * instances assume the directories are already present.
 */
export function ensureTraceDirs(projectId: string): void {
  const base = getProjectPath(projectId);
  mkdirSync(join(base, 'spans'), { recursive: true });
  mkdirSync(join(base, 'actions'), { recursive: true });
}

/**
 * Format the duration between two ISO timestamps as a human-readable string.
 * Returns '--' when no start time is provided.
 */
export function formatDuration(startTime?: string, endTime?: string): string {
  if (!startTime) return '--';
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date();
  const diffMs = end.getTime() - start.getTime();
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
