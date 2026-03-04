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

export function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function progressBar(progress: number, barWidth: number): string {
  const filled = Math.round((progress / 100) * barWidth);
  const empty = barWidth - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
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
        const filename = output.filename ? ` → \`${output.filename}\`` : '';
        section += `- \`${output.name}\` (${output.type}${filename}) — ${output.description}\n`;
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
