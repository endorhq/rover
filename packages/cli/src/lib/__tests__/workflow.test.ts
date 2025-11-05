import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initWorkflowStore } from '../workflow.js';

describe('workflow utilities', () => {
  let testDir: string;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'workflow-utils-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('initWorkflowStore()', () => {
    it('should return a WorkflowStore instance', () => {
      const store = initWorkflowStore();

      expect(store).toBeDefined();
      expect(typeof store.getWorkflow).toBe('function');
      expect(typeof store.getAllWorkflows).toBe('function');
    });

    it('should load built-in workflows', () => {
      const store = initWorkflowStore();
      const workflows = store.getAllWorkflows();

      expect(workflows.length).toBeGreaterThan(0);
    });

    it('should load the swe workflow', () => {
      const store = initWorkflowStore();
      const sweWorkflow = store.getWorkflow('swe');

      expect(sweWorkflow).toBeDefined();
      expect(sweWorkflow?.name).toBe('swe');
      expect(sweWorkflow?.description).toBe(
        'Complete software engineering workflow with adaptive complexity handling'
      );
    });

    it('should load the tech-writer workflow', () => {
      const store = initWorkflowStore();
      const techWriterWorkflow = store.getWorkflow('tech-writer');

      expect(techWriterWorkflow).toBeDefined();
      expect(techWriterWorkflow?.name).toBe('tech-writer');
      expect(techWriterWorkflow?.description).toBe(
        'Write documentation and tutorials for your technical projects'
      );
    });

    it('should load all expected built-in workflows', () => {
      const store = initWorkflowStore();
      const workflows = store.getAllWorkflows();

      const workflowNames = workflows.map(w => w.name);

      // Check that expected workflows are present
      expect(workflowNames).toContain('swe');
      expect(workflowNames).toContain('tech-writer');

      // Should have exactly 2 built-in workflows
      expect(workflows).toHaveLength(2);
    });

    it('should return workflows with proper structure', () => {
      const store = initWorkflowStore();
      const workflows = store.getAllWorkflows();

      for (const workflow of workflows) {
        // Each workflow should have required properties
        expect(workflow.name).toBeDefined();
        expect(typeof workflow.name).toBe('string');
        expect(workflow.name.length).toBeGreaterThan(0);

        expect(workflow.description).toBeDefined();
        expect(typeof workflow.description).toBe('string');

        expect(workflow.version).toBeDefined();
        expect(typeof workflow.version).toBe('string');

        expect(workflow.steps).toBeDefined();
        expect(Array.isArray(workflow.steps)).toBe(true);
        expect(workflow.steps.length).toBeGreaterThan(0);

        expect(workflow.inputs).toBeDefined();
        expect(Array.isArray(workflow.inputs)).toBe(true);

        expect(workflow.outputs).toBeDefined();
        expect(Array.isArray(workflow.outputs)).toBe(true);
      }
    });

    it('should load workflows with valid inputs and outputs', () => {
      const store = initWorkflowStore();
      const sweWorkflow = store.getWorkflow('swe');

      expect(sweWorkflow).toBeDefined();

      // SWE workflow should have inputs
      expect(sweWorkflow!.inputs).toBeDefined();
      expect(sweWorkflow!.inputs.length).toBeGreaterThan(0);

      // Check that inputs have required properties
      for (const input of sweWorkflow!.inputs) {
        expect(input.name).toBeDefined();
        expect(input.description).toBeDefined();
        expect(input.type).toBeDefined();
        expect(input.required).toBeDefined();
      }

      // SWE workflow should have outputs
      expect(sweWorkflow!.outputs).toBeDefined();
      expect(sweWorkflow!.outputs.length).toBeGreaterThan(0);

      // Check that outputs have required properties
      for (const output of sweWorkflow!.outputs) {
        expect(output.name).toBeDefined();
        expect(output.description).toBeDefined();
        expect(output.type).toBeDefined();
      }
    });

    it('should load workflows with valid steps', () => {
      const store = initWorkflowStore();
      const sweWorkflow = store.getWorkflow('swe');

      expect(sweWorkflow).toBeDefined();
      expect(sweWorkflow!.steps).toBeDefined();
      expect(sweWorkflow!.steps.length).toBeGreaterThan(0);

      // Check that steps have required properties
      for (const step of sweWorkflow!.steps) {
        expect(step.id).toBeDefined();
        expect(typeof step.id).toBe('string');
        expect(step.id.length).toBeGreaterThan(0);

        expect(step.type).toBe('agent');

        expect(step.name).toBeDefined();
        expect(typeof step.name).toBe('string');

        expect(step.prompt).toBeDefined();
        expect(typeof step.prompt).toBe('string');
        expect(step.prompt.length).toBeGreaterThan(0);

        expect(step.outputs).toBeDefined();
        expect(Array.isArray(step.outputs)).toBe(true);
      }
    });

    it('should load workflows with unique step IDs', () => {
      const store = initWorkflowStore();
      const workflows = store.getAllWorkflows();

      for (const workflow of workflows) {
        const stepIds = workflow.steps.map(s => s.id);
        const uniqueStepIds = new Set(stepIds);

        // All step IDs should be unique
        expect(uniqueStepIds.size).toBe(stepIds.length);
      }
    });

    it('should load workflows with proper defaults', () => {
      const store = initWorkflowStore();
      const sweWorkflow = store.getWorkflow('swe');

      expect(sweWorkflow).toBeDefined();

      // SWE workflow should have defaults
      if (sweWorkflow!.defaults) {
        expect(sweWorkflow!.defaults.tool).toBeDefined();
        expect(['claude', 'gemini']).toContain(sweWorkflow!.defaults.tool);
      }
    });

    it('should load workflows with proper config', () => {
      const store = initWorkflowStore();
      const sweWorkflow = store.getWorkflow('swe');

      expect(sweWorkflow).toBeDefined();

      // SWE workflow should have config
      if (sweWorkflow!.config) {
        expect(sweWorkflow!.config.timeout).toBeDefined();
        expect(typeof sweWorkflow!.config.timeout).toBe('number');
        expect(sweWorkflow!.config.timeout).toBeGreaterThan(0);

        expect(sweWorkflow!.config.continueOnError).toBeDefined();
        expect(typeof sweWorkflow!.config.continueOnError).toBe('boolean');
      }
    });

    it('should allow retrieval of workflows from store', () => {
      const store = initWorkflowStore();

      // Get workflow by name
      const sweWorkflow = store.getWorkflow('swe');
      expect(sweWorkflow).toBeDefined();
      expect(sweWorkflow?.name).toBe('swe');

      // Get all workflows
      const allWorkflows = store.getAllWorkflows();
      expect(allWorkflows.length).toBeGreaterThan(0);

      // Verify that workflows are in the store
      const workflowNames = allWorkflows.map(w => w.name);
      expect(workflowNames).toContain('swe');
      expect(workflowNames).toContain('tech-writer');
    });

    it('should return undefined for non-existent workflows', () => {
      const store = initWorkflowStore();
      const nonExistent = store.getWorkflow('non-existent-workflow');

      expect(nonExistent).toBeUndefined();
    });

    it('should load workflows that can be used with WorkflowManager methods', () => {
      const store = initWorkflowStore();
      const sweWorkflow = store.getWorkflow('swe');

      expect(sweWorkflow).toBeDefined();

      // Should be able to get step by ID
      const contextStep = sweWorkflow!.getStep('context');
      expect(contextStep).toBeDefined();
      expect(contextStep.id).toBe('context');
      expect(contextStep.name).toBe('Context Analysis');

      // Should be able to get step tool
      const tool = sweWorkflow!.getStepTool('context');
      expect(tool).toBeDefined();
      expect(typeof tool).toBe('string');

      // Should be able to get step model
      const model = sweWorkflow!.getStepModel('context');
      expect(model).toBeDefined();
      expect(typeof model).toBe('string');

      // Should be able to get step timeout
      const timeout = sweWorkflow!.getStepTimeout('context');
      expect(timeout).toBeDefined();
      expect(typeof timeout).toBe('number');
      expect(timeout).toBeGreaterThan(0);
    });

    it('should load tech-writer workflow with optional inputs', () => {
      const store = initWorkflowStore();
      const techWriterWorkflow = store.getWorkflow('tech-writer');

      expect(techWriterWorkflow).toBeDefined();

      // Tech writer workflow has optional inputs with defaults
      const optionalInputs = techWriterWorkflow!.inputs.filter(
        input => !input.required
      );
      expect(optionalInputs.length).toBeGreaterThan(0);

      // Optional inputs should have default values
      for (const input of optionalInputs) {
        expect(input.default).toBeDefined();
      }
    });

    it('should load workflows with file output types', () => {
      const store = initWorkflowStore();
      const sweWorkflow = store.getWorkflow('swe');

      expect(sweWorkflow).toBeDefined();

      // SWE workflow outputs should be of type 'file'
      const fileOutputs = sweWorkflow!.outputs.filter(
        output => output.type === 'file'
      );
      expect(fileOutputs.length).toBeGreaterThan(0);

      // File outputs should have filenames
      for (const output of fileOutputs) {
        // @ts-ignore - filename property is on file outputs
        expect(output.filename).toBeDefined();
        // @ts-ignore
        expect(typeof output.filename).toBe('string');
      }
    });

    it('should validate inputs on loaded workflows', () => {
      const store = initWorkflowStore();
      const sweWorkflow = store.getWorkflow('swe');

      expect(sweWorkflow).toBeDefined();

      // Test validation with valid inputs
      const validInputs = new Map([['description', 'Test task description']]);
      const validation = sweWorkflow!.validateInputs(validInputs);

      expect(validation).toBeDefined();
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect missing required inputs on loaded workflows', () => {
      const store = initWorkflowStore();
      const sweWorkflow = store.getWorkflow('swe');

      expect(sweWorkflow).toBeDefined();

      // Test validation with missing required inputs
      const emptyInputs = new Map<string, string>();
      const validation = sweWorkflow!.validateInputs(emptyInputs);

      expect(validation).toBeDefined();
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });

    it('should export workflows to YAML format', () => {
      const store = initWorkflowStore();
      const sweWorkflow = store.getWorkflow('swe');

      expect(sweWorkflow).toBeDefined();

      // Should be able to export to YAML
      const yamlString = sweWorkflow!.toYaml();
      expect(yamlString).toBeDefined();
      expect(typeof yamlString).toBe('string');
      expect(yamlString.length).toBeGreaterThan(0);

      // YAML should contain workflow name
      expect(yamlString).toContain('name: swe');
    });
  });

  describe('workflow integrity', () => {
    it('should load workflows with consistent version', () => {
      const store = initWorkflowStore();
      const workflows = store.getAllWorkflows();

      for (const workflow of workflows) {
        // All workflows should have version 1.0
        expect(workflow.version).toBe('1.0');
      }
    });

    it('should load workflows with valid step references in prompts', () => {
      const store = initWorkflowStore();
      const sweWorkflow = store.getWorkflow('swe');

      expect(sweWorkflow).toBeDefined();

      // Check that step prompts reference valid inputs and previous steps
      for (const step of sweWorkflow!.steps) {
        // Prompts should not be empty
        expect(step.prompt.trim().length).toBeGreaterThan(0);

        // Extract step references from prompt (e.g., {{steps.context.outputs.context_file}})
        const stepReferencePattern = /{{steps\.(\w+)\./g;
        const matches = [...step.prompt.matchAll(stepReferencePattern)];

        for (const match of matches) {
          const referencedStepId = match[1];

          // Referenced step should exist in workflow
          const referencedStep = sweWorkflow!.steps.find(
            s => s.id === referencedStepId
          );
          expect(referencedStep).toBeDefined();

          // Referenced step should come before current step
          const referencedStepIndex = sweWorkflow!.steps.indexOf(
            referencedStep!
          );
          const currentStepIndex = sweWorkflow!.steps.indexOf(step);
          expect(referencedStepIndex).toBeLessThan(currentStepIndex);
        }
      }
    });

    it('should load workflows with input references in prompts', () => {
      const store = initWorkflowStore();
      const sweWorkflow = store.getWorkflow('swe');

      expect(sweWorkflow).toBeDefined();

      // Check that step prompts can contain input references
      for (const step of sweWorkflow!.steps) {
        // Extract input references from prompt (e.g., {{inputs.description}})
        const inputReferencePattern = /{{inputs\.(\w+)}}/g;
        const matches = [...step.prompt.matchAll(inputReferencePattern)];

        // Verify input references follow expected pattern
        for (const match of matches) {
          const referencedInputName = match[1];
          expect(typeof referencedInputName).toBe('string');
          expect(referencedInputName.length).toBeGreaterThan(0);
        }
      }
    });

    it('should load workflows where each step has valid outputs', () => {
      const store = initWorkflowStore();
      const workflows = store.getAllWorkflows();

      for (const workflow of workflows) {
        for (const step of workflow.steps) {
          // Each step should have outputs defined
          expect(step.outputs).toBeDefined();
          expect(Array.isArray(step.outputs)).toBe(true);

          // Each output should have required properties
          for (const output of step.outputs || []) {
            expect(output.name).toBeDefined();
            expect(typeof output.name).toBe('string');
            expect(output.name.length).toBeGreaterThan(0);

            expect(output.description).toBeDefined();
            expect(typeof output.description).toBe('string');

            expect(output.type).toBeDefined();
            expect(typeof output.type).toBe('string');
          }
        }
      }
    });
  });
});
