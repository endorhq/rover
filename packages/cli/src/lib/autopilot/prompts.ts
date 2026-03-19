import type { WorkflowStore } from 'rover-core';

export interface PromptPlaceholderVars {
  botName?: string;
  memoryCollection?: string;
  customInstructions?: string;
  workflowStore?: WorkflowStore;
}

/**
 * Build a Markdown catalog of available workflows from the WorkflowStore.
 * Injected into coordinator and planner prompts so the AI knows which
 * workflows exist and what inputs/outputs they accept.
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

    if (wf.outputs.length > 0) {
      section += '**Outputs**:\n';
      for (const output of wf.outputs) {
        const filename = output.filename ? ` → \`${output.filename}\`` : '';
        section += `- \`${output.name}\` (${output.type}${filename}) — ${output.description}\n`;
      }
      section += '\n';
    }

    if (wf.steps.length > 0) {
      section += '**Steps**: ';
      section += wf.steps.map(s => `\`${s.id}\``).join(' → ');
      section += '\n';
    }

    sections.push(section);
  }

  return sections.join('\n');
}

/**
 * Replace shared placeholders that appear across multiple step prompts.
 * Each step can extend with step-specific replacements after calling this.
 */
export function replacePromptPlaceholders(
  template: string,
  vars: PromptPlaceholderVars
): string {
  let prompt = template;

  prompt = prompt.replaceAll(
    '{{BOT_ACCOUNT}}',
    vars.botName || 'the bot account'
  );

  prompt = prompt.replaceAll(
    '{{MEMORY_COLLECTION}}',
    vars.memoryCollection || 'rover-memory'
  );

  prompt = prompt.replace(
    '{{CUSTOM_INSTRUCTIONS}}',
    vars.customInstructions || ''
  );

  const catalog = vars.workflowStore
    ? buildWorkflowCatalog(vars.workflowStore)
    : '*(No workflows available)*';
  prompt = prompt.replace('{{WORKFLOW_CATALOG}}', catalog);

  return prompt;
}
