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
