import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { Git, getDataDir } from 'rover-core';
import type { WorkflowStore } from 'rover-core';

export function getRepoInfo(projectPath: string): {
  owner: string;
  repo: string;
} | null {
  const git = new Git({ cwd: projectPath });
  const remoteUrl = git.remoteUrl();
  if (!remoteUrl) return null;

  const patterns = [
    /github[^:/]*[:/]([^/]+)\/([^/.]+)(\.git)?$/,
    /^https?:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/,
  ];

  for (const pattern of patterns) {
    const match = remoteUrl.match(pattern);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  }

  return null;
}

/**
 * Ensures the spans/ and actions/ directories exist for a project.
 * Call once at autopilot startup — individual SpanWriter / ActionWriter
 * instances assume the directories are already present.
 */
export function ensureTraceDirs(projectId: string): void {
  const base = join(getDataDir(), 'projects', projectId);
  mkdirSync(join(base, 'spans'), { recursive: true });
  mkdirSync(join(base, 'actions'), { recursive: true });
}

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

const STAR_CHARS = ['.', '\u00B7', '*', '+', '\u2022'];
const STAR_SPEEDS = [1, 1, 2, 2, 3];

interface Star {
  x: number;
  y: number;
  char: string;
  speed: number;
}

export function createStarField(width: number, height: number): Star[] {
  const count = Math.floor((width * height) / 18);
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * STAR_CHARS.length);
    stars.push({
      x: Math.floor(Math.random() * width),
      y: Math.floor(Math.random() * height),
      char: STAR_CHARS[idx],
      speed: STAR_SPEEDS[idx],
    });
  }
  return stars;
}

export function advanceStars(
  stars: Star[],
  width: number,
  height: number
): Star[] {
  return stars.map(s => {
    let nx = s.x - s.speed;
    if (nx < 0) {
      nx = width - 1;
      return {
        ...s,
        x: nx,
        y: Math.floor(Math.random() * height),
      };
    }
    return { ...s, x: nx };
  });
}

export function renderStarField(
  stars: Star[],
  width: number,
  height: number
): string[] {
  const grid: string[][] = Array.from({ length: height }, () =>
    Array(width).fill(' ')
  );

  for (const s of stars) {
    if (s.y >= 0 && s.y < height && s.x >= 0 && s.x < width) {
      grid[s.y][s.x] = s.char;
    }
  }

  return grid.map(row => row.join(''));
}

// A small planet rendered near the bottom of the space scene
const PLANET_ART = [
  '        .--.',
  "      .'    `.",
  '     /  O  o  \\',
  '    |     .    |',
  '     \\  o    /',
  "      `.  .'",
  "        `'",
];

export function getPlanetArt(): string[] {
  return PLANET_ART;
}

export function getSlotFill(
  status: 'idle' | 'running' | 'done' | 'error'
): string {
  switch (status) {
    case 'idle':
      return '\u2591';
    case 'running':
      return '\u2593';
    case 'done':
      return '\u2588';
    case 'error':
      return '\u2573';
  }
}

/**
 * Build a Markdown catalog of available workflows from the WorkflowStore.
 * This is injected into both the coordinator and planner prompts so the AI
 * knows which workflows exist.
 */
export function buildWorkflowCatalog(workflowStore: WorkflowStore): string {
  const entries = workflowStore.getAllWorkflowEntries();
  if (entries.length === 0) {
    return '*(No workflows available)*';
  }

  const sections: string[] = [];

  for (const entry of entries) {
    const wf = entry.workflow;
    let section = `### \`${wf.name}\` — ${wf.description}\n\n`;

    // Inputs
    if (wf.inputs.length > 0) {
      section += '**Inputs**:\n';
      for (const input of wf.inputs) {
        const req = input.required ? 'required' : 'optional';
        const def =
          input.default !== undefined ? `, default: \`${input.default}\`` : '';
        section += `- \`${input.name}\` (${input.type}, ${req}${def}) — ${input.description}\n`;
      }
      section += '\n';
    }

    // Outputs
    if (wf.outputs.length > 0) {
      section += '**Outputs**:\n';
      for (const output of wf.outputs) {
        section += `- \`${output.name}\` (${output.type}) — ${output.description}\n`;
      }
      section += '\n';
    }

    // Steps summary
    if (wf.steps.length > 0) {
      section += '**Steps**: ';
      section += wf.steps.map(s => `\`${s.id}\``).join(' → ');
      section += '\n';
    }

    sections.push(section);
  }

  return sections.join('\n');
}
