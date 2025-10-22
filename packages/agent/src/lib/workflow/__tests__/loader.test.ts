/**
 * Tests for workflow loader
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadWorkflow,
  loadWorkflowFromString,
  WorkflowLoadError,
  WorkflowValidationError,
} from '../loader.js';
import type { Workflow, AgentStep } from '../types.js';

describe('Workflow loader', () => {
  describe('loadWorkflow', () => {
    it('should load and validate the actual swe.yml workflow file', () => {
      // From the monorepo root
      const workflowPath = join(
        process.cwd(),
        '../..',
        'packages/cli/src/lib/workflows/swe.yml'
      );
      const workflow = loadWorkflow(workflowPath);

      expect(workflow.version).toBe('1.0');
      expect(workflow.name).toBe('swe');
      expect(workflow.description).toBe(
        'Complete software engineering workflow with adaptive complexity handling'
      );
      expect(workflow.inputs).toBeDefined();
      expect(workflow.inputs?.length).toBe(1); // Only 'description' input
      expect(workflow.outputs).toBeDefined();
      expect(workflow.outputs?.length).toBe(4);
      expect(workflow.steps).toBeDefined();
      expect(workflow.steps.length).toBeGreaterThan(0);
    });

    it('should throw WorkflowLoadError when file does not exist', () => {
      expect(() => loadWorkflow('/nonexistent/file.yml')).toThrow(
        WorkflowLoadError
      );
    });

    it('should throw WorkflowLoadError for invalid YAML', () => {
      const tmpFile = join(tmpdir(), `test-workflow-${Date.now()}.yml`);
      writeFileSync(tmpFile, 'invalid: yaml: content: [[[');

      expect(() => loadWorkflow(tmpFile)).toThrow(WorkflowLoadError);
    });

    it('should throw WorkflowValidationError for workflow missing required fields', () => {
      const tmpFile = join(tmpdir(), `test-workflow-${Date.now()}.yml`);
      writeFileSync(
        tmpFile,
        `
version: '1.0'
# missing name, description, steps
      `.trim()
      );

      expect(() => loadWorkflow(tmpFile)).toThrow(WorkflowValidationError);
    });

    it('should validate workflow with only agent steps', () => {
      const tmpFile = join(tmpdir(), `test-workflow-${Date.now()}.yml`);
      writeFileSync(
        tmpFile,
        `
version: '1.0'
name: 'test'
description: 'Test workflow'
steps:
  - id: agent1
    type: agent
    name: 'Agent Step 1'
    prompt: 'Do something'
  - id: agent2
    type: agent
    name: 'Agent Step 2'
    prompt: 'Do something else'
      `.trim()
      );

      const workflow = loadWorkflow(tmpFile);

      expect(workflow.steps).toHaveLength(2);
      expect(workflow.steps[0].type).toBe('agent');
      expect(workflow.steps[1].type).toBe('agent');
    });

    it('should preserve template variables in prompts', () => {
      const tmpFile = join(tmpdir(), `test-workflow-${Date.now()}.yml`);
      writeFileSync(
        tmpFile,
        `
version: '1.0'
name: 'test'
description: 'Test workflow'
steps:
  - id: step1
    type: agent
    name: 'Step with template'
    prompt: 'Use {{inputs.title}} and {{steps.context.outputs.file}}'
      `.trim()
      );

      const workflow = loadWorkflow(tmpFile);
      const agentStep = workflow.steps[0] as AgentStep;

      expect(agentStep.prompt).toContain('{{inputs.title}}');
      expect(agentStep.prompt).toContain('{{steps.context.outputs.file}}');
    });

    it('should validate workflow with inputs and outputs', () => {
      const tmpFile = join(tmpdir(), `test-workflow-${Date.now()}.yml`);
      writeFileSync(
        tmpFile,
        `
version: '1.0'
name: 'test'
description: 'Test workflow'
inputs:
  - name: title
    description: 'Task title'
    type: string
    required: true
  - name: count
    description: 'Count'
    type: number
    required: false
outputs:
  - name: result
    description: 'Result'
    type: string
  - name: report
    description: 'Report file'
    type: file
    filename: report.md
steps:
  - id: step1
    type: agent
    name: 'Step'
    prompt: 'Do something'
      `.trim()
      );

      const workflow = loadWorkflow(tmpFile);

      expect(workflow.inputs).toBeDefined();
      expect(workflow.inputs?.length).toBe(2);
      expect(workflow.inputs?.[0].name).toBe('title');
      expect(workflow.inputs?.[0].type).toBe('string');
      expect(workflow.inputs?.[0].required).toBe(true);

      expect(workflow.outputs).toBeDefined();
      expect(workflow.outputs?.length).toBe(2);
      expect(workflow.outputs?.[0].name).toBe('result');
      expect(workflow.outputs?.[1].filename).toBe('report.md');
    });

    it('should validate workflow with defaults and config', () => {
      const tmpFile = join(tmpdir(), `test-workflow-${Date.now()}.yml`);
      writeFileSync(
        tmpFile,
        `
version: '1.0'
name: 'test'
description: 'Test workflow'
defaults:
  tool: claude
  model: sonnet
config:
  timeout: 3600
  continueOnError: true
steps:
  - id: step1
    type: agent
    name: 'Step'
    prompt: 'Do something'
      `.trim()
      );

      const workflow = loadWorkflow(tmpFile);

      expect(workflow.defaults).toBeDefined();
      expect(workflow.defaults?.tool).toBe('claude');
      expect(workflow.defaults?.model).toBe('sonnet');

      expect(workflow.config).toBeDefined();
      expect(workflow.config?.timeout).toBe(3600);
      expect(workflow.config?.continueOnError).toBe(true);
    });

    it('should throw WorkflowValidationError with detailed error messages', () => {
      const tmpFile = join(tmpdir(), `test-workflow-${Date.now()}.yml`);
      writeFileSync(
        tmpFile,
        `
version: '1.0'
name: 'test'
description: 'Test workflow'
steps:
  - id: bad_step
    type: invalid_type
    name: 'Bad Step'
      `.trim()
      );

      try {
        loadWorkflow(tmpFile);
        expect.fail('Should have thrown WorkflowValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(WorkflowValidationError);
        if (error instanceof WorkflowValidationError) {
          expect(error.message).toContain('Workflow validation failed');
          expect(error.validationErrors).toBeDefined();
        }
      }
    });
  });

  describe('loadWorkflowFromString', () => {
    it('should load workflow from valid YAML string', () => {
      const yamlContent = `
version: '1.0'
name: 'test'
description: 'Test workflow'
steps:
  - id: step1
    type: agent
    name: 'Step 1'
    prompt: 'Do something'
      `.trim();

      const workflow = loadWorkflowFromString(yamlContent);

      expect(workflow.version).toBe('1.0');
      expect(workflow.name).toBe('test');
      expect(workflow.description).toBe('Test workflow');
      expect(workflow.steps).toHaveLength(1);
    });

    it('should throw WorkflowLoadError for invalid YAML string', () => {
      const invalidYaml = 'invalid: yaml: content: [[[';

      expect(() => loadWorkflowFromString(invalidYaml)).toThrow(
        WorkflowLoadError
      );
    });

    it('should throw WorkflowValidationError for invalid workflow structure', () => {
      const yamlContent = `
version: '1.0'
# missing required fields
      `.trim();

      expect(() => loadWorkflowFromString(yamlContent)).toThrow(
        WorkflowValidationError
      );
    });
  });

  describe('agent step validation', () => {
    it('should validate agent step with outputs', () => {
      const yamlContent = `
version: '1.0'
name: 'test'
description: 'Test workflow'
steps:
  - id: agent1
    type: agent
    name: 'Agent with outputs'
    prompt: 'Generate something'
    outputs:
      - name: result
        description: 'Result'
        type: string
      - name: file
        description: 'File output'
        type: file
        filename: output.md
      `.trim();

      const workflow = loadWorkflowFromString(yamlContent);
      const agentStep = workflow.steps[0] as AgentStep;

      expect(agentStep.type).toBe('agent');
      expect(agentStep.outputs).toBeDefined();
      expect(agentStep.outputs?.length).toBe(2);
      expect(agentStep.outputs?.[0].name).toBe('result');
      expect(agentStep.outputs?.[1].filename).toBe('output.md');
    });

    it('should validate multiple agent steps', () => {
      const yamlContent = `
version: '1.0'
name: 'test'
description: 'Test workflow'
steps:
  - id: agent1
    type: agent
    name: 'First agent'
    prompt: 'First task'
  - id: agent2
    type: agent
    name: 'Second agent'
    prompt: 'Second task'
  - id: agent3
    type: agent
    name: 'Third agent'
    prompt: 'Third task'
      `.trim();

      const workflow = loadWorkflowFromString(yamlContent);

      expect(workflow.steps).toHaveLength(3);
      workflow.steps.forEach(step => {
        expect(step.type).toBe('agent');
        const agentStep = step as AgentStep;
        expect(agentStep.prompt).toBeDefined();
      });
    });
  });

  describe('error handling', () => {
    it('should provide clear error messages for missing required step fields', () => {
      const yamlContent = `
version: '1.0'
name: 'test'
description: 'Test workflow'
steps:
  - id: agent1
    type: agent
    name: 'Missing prompt'
      `.trim();

      try {
        loadWorkflowFromString(yamlContent);
        expect.fail('Should have thrown WorkflowValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(WorkflowValidationError);
        if (error instanceof WorkflowValidationError) {
          // With a union type, the error is less specific but still indicates the step is invalid
          expect(error.message).toContain('steps.0');
          expect(error.message).toContain('Invalid input');
        }
      }
    });

    it('should provide clear error messages for invalid step type', () => {
      const yamlContent = `
version: '1.0'
name: 'test'
description: 'Test workflow'
steps:
  - id: bad
    type: unknown_type
    name: 'Bad step'
      `.trim();

      try {
        loadWorkflowFromString(yamlContent);
        expect.fail('Should have thrown WorkflowValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(WorkflowValidationError);
        if (error instanceof WorkflowValidationError) {
          // With a union type, the error is less specific but still indicates the step is invalid
          expect(error.message).toContain('steps.0');
          expect(error.message).toContain('Invalid input');
        }
      }
    });

    it('should provide clear error messages for invalid input types', () => {
      const yamlContent = `
version: '1.0'
name: 'test'
description: 'Test workflow'
inputs:
  - name: bad_input
    description: 'Bad input'
    type: invalid_type
    required: true
steps:
  - id: step1
    type: agent
    name: 'Step'
    prompt: 'Do something'
      `.trim();

      try {
        loadWorkflowFromString(yamlContent);
        expect.fail('Should have thrown WorkflowValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(WorkflowValidationError);
      }
    });
  });
});
