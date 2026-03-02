import { join } from 'node:path';
import { readFileSync } from 'node:fs';

export interface CustomInstructions {
  general: string | null;
  stepSpecific: string | null;
}

/**
 * Load custom instruction files from the project's `.rover/` directory.
 *
 * Reads per-call (not cached) — files may change while autopilot runs
 * and the I/O cost is negligible compared to the AI call.
 */
export function loadCustomInstructions(
  projectPath: string,
  stepName: string
): CustomInstructions {
  const roverDir = join(projectPath, '.rover');

  let general: string | null = null;
  try {
    const content = readFileSync(
      join(roverDir, 'AUTOPILOT.md'),
      'utf-8'
    ).trim();
    if (content) general = content;
  } catch {
    // File doesn't exist or is unreadable — skip
  }

  let stepSpecific: string | null = null;
  try {
    const content = readFileSync(
      join(roverDir, `AUTOPILOT.${stepName}.md`),
      'utf-8'
    ).trim();
    if (content) stepSpecific = content;
  } catch {
    // File doesn't exist or is unreadable — skip
  }

  return { general, stepSpecific };
}

/**
 * Format custom instructions into a markdown section for prompt injection.
 * Returns an empty string if no instructions are present.
 */
export function formatCustomInstructions(
  instructions: CustomInstructions
): string {
  if (!instructions.general && !instructions.stepSpecific) {
    return '';
  }

  let section = '\n\n## Custom Instructions\n\n';

  if (instructions.general) {
    section += instructions.general + '\n';
  }

  if (instructions.stepSpecific) {
    if (instructions.general) {
      section += '\n### Step-Specific Instructions (take precedence)\n\n';
    }
    section += instructions.stepSpecific + '\n';
  }

  return section;
}

/**
 * Build a maintainers section for prompt injection.
 * Returns an empty string if no maintainers are provided.
 */
export function formatMaintainers(maintainers?: string[]): string {
  if (!maintainers || maintainers.length === 0) {
    return '';
  }

  const handles = maintainers.map(m => (m.startsWith('@') ? m : `@${m}`));
  return `\n\n## Maintainers\n\nThe following GitHub handles are project maintainers: ${handles.join(', ')}\n`;
}
