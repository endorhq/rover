import { describe, expect, it } from 'vitest';
import { loadWorkflowByName } from '../workflow.js';

describe('workflow metadata resolution', () => {
  it('loads swe workflow without falling through to other definitions', () => {
    const workflow = loadWorkflowByName('swe');

    expect(workflow).toBeDefined();
    expect(workflow?.inputs).toHaveLength(1);
    expect(workflow?.inputs?.[0]?.name).toBe('description');
    expect(workflow?.inputs?.[0]?.required).toBe(true);
  });

  it('treats swe workflow as description-only for CLI ingestion paths', () => {
    const workflow = loadWorkflowByName('swe');

    const requiredInputs =
      workflow?.inputs
        ?.filter(input => input.required)
        .map(input => input.name) ?? [];

    expect(requiredInputs).toEqual(['description']);
  });
});
