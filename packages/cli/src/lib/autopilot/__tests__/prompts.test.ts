import { describe, it, expect } from 'vitest';
import {
  buildWorkflowCatalog,
  replacePromptPlaceholders,
} from '../prompts.js';
import type { WorkflowStore } from 'rover-core';

describe('replacePromptPlaceholders', () => {
  const template =
    'Bot: {{BOT_ACCOUNT}}, Memory: {{MEMORY_COLLECTION}}, ' +
    'Instructions: {{CUSTOM_INSTRUCTIONS}}, Workflows: {{WORKFLOW_CATALOG}}';

  it('replaces all shared placeholders with provided values', () => {
    const result = replacePromptPlaceholders(template, {
      botName: 'rover-bot',
      memoryCollection: 'my-collection',
      customInstructions: 'Do X and Y.',
    });

    expect(result).toContain('Bot: rover-bot');
    expect(result).toContain('Memory: my-collection');
    expect(result).toContain('Instructions: Do X and Y.');
    expect(result).toContain('*(No workflows available)*');
  });

  it('uses sensible defaults for missing values', () => {
    const result = replacePromptPlaceholders(template, {});

    expect(result).toContain('Bot: the bot account');
    expect(result).toContain('Memory: rover-memory');
    expect(result).toContain('Instructions: ,');
    expect(result).toContain('*(No workflows available)*');
  });

  it('replaces all occurrences of BOT_ACCOUNT and MEMORY_COLLECTION', () => {
    const multi =
      '{{BOT_ACCOUNT}} says hi. Check {{BOT_ACCOUNT}}. ' +
      'Use {{MEMORY_COLLECTION}} or {{MEMORY_COLLECTION}}.';

    const result = replacePromptPlaceholders(multi, {
      botName: 'mybot',
      memoryCollection: 'col-1',
    });

    expect(result).toBe('mybot says hi. Check mybot. Use col-1 or col-1.');
  });
});

function makeWorkflowStore(
  entries: Array<{
    name: string;
    description: string;
    inputs?: Array<{
      name: string;
      type: string;
      required: boolean;
      default?: string;
      description: string;
    }>;
    outputs?: Array<{
      name: string;
      type: string;
      filename?: string;
      description: string;
    }>;
    steps?: Array<{ id: string }>;
  }>
): WorkflowStore {
  return {
    getAllWorkflowEntries: () =>
      entries.map(e => ({
        workflow: {
          name: e.name,
          description: e.description,
          inputs: e.inputs ?? [],
          outputs: e.outputs ?? [],
          steps: e.steps ?? [],
        },
        source: 'project',
      })),
  } as unknown as WorkflowStore;
}

describe('buildWorkflowCatalog', () => {
  it('returns placeholder when store is empty', () => {
    const store = makeWorkflowStore([]);
    expect(buildWorkflowCatalog(store)).toBe('*(No workflows available)*');
  });

  it('formats a workflow with inputs, outputs, and steps', () => {
    const store = makeWorkflowStore([
      {
        name: 'code-review',
        description: 'Review a PR',
        inputs: [
          {
            name: 'pr_number',
            type: 'number',
            required: true,
            description: 'The PR to review',
          },
          {
            name: 'depth',
            type: 'string',
            required: false,
            default: 'normal',
            description: 'Review depth',
          },
        ],
        outputs: [
          {
            name: 'report',
            type: 'file',
            filename: 'review.md',
            description: 'Review report',
          },
        ],
        steps: [{ id: 'analyze' }, { id: 'comment' }],
      },
    ]);

    const result = buildWorkflowCatalog(store);

    expect(result).toContain('### `code-review` — Review a PR');
    expect(result).toContain(
      '`pr_number` (number, required) — The PR to review'
    );
    expect(result).toContain(
      '`depth` (string, optional, default: `normal`) — Review depth'
    );
    expect(result).toContain('`report` (file → `review.md`) — Review report');
    expect(result).toContain('`analyze` → `comment`');
  });

  it('formats multiple workflows', () => {
    const store = makeWorkflowStore([
      { name: 'wf-a', description: 'First workflow' },
      { name: 'wf-b', description: 'Second workflow' },
    ]);

    const result = buildWorkflowCatalog(store);
    expect(result).toContain('`wf-a`');
    expect(result).toContain('`wf-b`');
  });

  it('handles workflow with no inputs/outputs/steps', () => {
    const store = makeWorkflowStore([
      { name: 'simple', description: 'A simple workflow' },
    ]);

    const result = buildWorkflowCatalog(store);
    expect(result).toContain('### `simple` — A simple workflow');
    expect(result).not.toContain('**Inputs**');
    expect(result).not.toContain('**Outputs**');
    expect(result).not.toContain('**Steps**');
  });
});
