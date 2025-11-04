import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowStore } from '../workflow-store.js';
import { WorkflowManager } from '../workflow.js';
import type { WorkflowAgentStep } from '../workflow/types.js';

describe('WorkflowStore', () => {
  let testDir: string;
  let workflowPath1: string;
  let workflowPath2: string;
  let store: WorkflowStore;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'workflow-store-test-'));
    workflowPath1 = join(testDir, 'workflow1.yaml');
    workflowPath2 = join(testDir, 'workflow2.yaml');
    store = new WorkflowStore();
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('addWorkflow()', () => {
    it('should add a workflow to the store', () => {
      const workflow = WorkflowManager.create(
        workflowPath1,
        'test-workflow',
        'Test workflow description',
        [],
        [],
        []
      );

      store.addWorkflow(workflow);

      const retrieved = store.getWorkflow('test-workflow');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('test-workflow');
      expect(retrieved?.description).toBe('Test workflow description');
    });

    it('should add multiple workflows to the store', () => {
      const workflow1 = WorkflowManager.create(
        workflowPath1,
        'workflow-1',
        'First workflow',
        [],
        [],
        []
      );

      const workflow2 = WorkflowManager.create(
        workflowPath2,
        'workflow-2',
        'Second workflow',
        [],
        [],
        []
      );

      store.addWorkflow(workflow1);
      store.addWorkflow(workflow2);

      expect(store.getWorkflow('workflow-1')).toBeDefined();
      expect(store.getWorkflow('workflow-2')).toBeDefined();
      expect(store.getAllWorkflows()).toHaveLength(2);
    });

    it('should replace workflow with duplicate name', () => {
      const workflow1 = WorkflowManager.create(
        workflowPath1,
        'duplicate-name',
        'First description',
        [],
        [],
        []
      );

      const workflow2 = WorkflowManager.create(
        workflowPath2,
        'duplicate-name',
        'Second description',
        [],
        [],
        []
      );

      store.addWorkflow(workflow1);
      store.addWorkflow(workflow2);

      const retrieved = store.getWorkflow('duplicate-name');
      expect(retrieved?.description).toBe('Second description');
      expect(store.getAllWorkflows()).toHaveLength(1);
    });

    it('should add workflow with steps and inputs', () => {
      const steps: WorkflowAgentStep[] = [
        {
          id: 'step1',
          type: 'agent',
          name: 'Process Data',
          prompt: 'Process the data',
          outputs: [],
        },
      ];

      const workflow = WorkflowManager.create(
        workflowPath1,
        'complex-workflow',
        'Workflow with steps',
        [
          {
            name: 'input1',
            description: 'Test input',
            type: 'string',
            required: true,
          },
        ],
        [],
        steps
      );

      store.addWorkflow(workflow);

      const retrieved = store.getWorkflow('complex-workflow');
      expect(retrieved?.steps).toHaveLength(1);
      expect(retrieved?.inputs).toHaveLength(1);
      expect(retrieved?.steps[0].id).toBe('step1');
    });
  });

  describe('loadWorkflow()', () => {
    it('should load a workflow from file and add it to the store', () => {
      const yamlContent = `
version: '1.0'
name: loaded-workflow
description: Workflow loaded from file
inputs: []
outputs: []
defaults:
  tool: claude
  model: claude-3-sonnet
config:
  timeout: 3600
  continueOnError: false
steps:
  - id: step1
    type: agent
    name: Step 1
    prompt: Test prompt
    outputs: []
`;

      writeFileSync(workflowPath1, yamlContent, 'utf8');

      store.loadWorkflow(workflowPath1);

      const retrieved = store.getWorkflow('loaded-workflow');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('loaded-workflow');
      expect(retrieved?.description).toBe('Workflow loaded from file');
      expect(retrieved?.steps).toHaveLength(1);
    });

    it('should load multiple workflows from files', () => {
      const yamlContent1 = `
version: '1.0'
name: workflow-1
description: First workflow
inputs: []
outputs: []
steps: []
`;

      const yamlContent2 = `
version: '1.0'
name: workflow-2
description: Second workflow
inputs: []
outputs: []
steps: []
`;

      writeFileSync(workflowPath1, yamlContent1, 'utf8');
      writeFileSync(workflowPath2, yamlContent2, 'utf8');

      store.loadWorkflow(workflowPath1);
      store.loadWorkflow(workflowPath2);

      expect(store.getAllWorkflows()).toHaveLength(2);
      expect(store.getWorkflow('workflow-1')).toBeDefined();
      expect(store.getWorkflow('workflow-2')).toBeDefined();
    });

    it('should throw error when loading non-existent file', () => {
      const nonExistentPath = join(testDir, 'non-existent.yaml');

      expect(() => {
        store.loadWorkflow(nonExistentPath);
      }).toThrow('Workflow configuration not found');
    });

    it('should throw error when loading invalid YAML file', () => {
      const invalidYaml = `
version: '1.0'
name: invalid-workflow
  - this is invalid YAML
description: test
`;

      writeFileSync(workflowPath1, invalidYaml, 'utf8');

      expect(() => {
        store.loadWorkflow(workflowPath1);
      }).toThrow('Failed to load workflow config');
    });

    it('should throw error when loading YAML with missing required fields', () => {
      const incompleteYaml = `
version: '1.0'
description: Missing name field
inputs: []
outputs: []
steps: []
`;

      writeFileSync(workflowPath1, incompleteYaml, 'utf8');

      expect(() => {
        store.loadWorkflow(workflowPath1);
      }).toThrow(); // Zod validation error
    });
  });

  describe('getWorkflow()', () => {
    it('should return workflow by name', () => {
      const workflow = WorkflowManager.create(
        workflowPath1,
        'test-workflow',
        'Test workflow',
        [],
        [],
        []
      );

      store.addWorkflow(workflow);

      const retrieved = store.getWorkflow('test-workflow');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('test-workflow');
    });

    it('should return undefined for non-existent workflow', () => {
      const retrieved = store.getWorkflow('non-existent');
      expect(retrieved).toBeUndefined();
    });

    it('should return correct workflow when multiple workflows exist', () => {
      const workflow1 = WorkflowManager.create(
        workflowPath1,
        'workflow-1',
        'First workflow',
        [],
        [],
        []
      );

      const workflow2 = WorkflowManager.create(
        workflowPath2,
        'workflow-2',
        'Second workflow',
        [],
        [],
        []
      );

      store.addWorkflow(workflow1);
      store.addWorkflow(workflow2);

      const retrieved = store.getWorkflow('workflow-2');
      expect(retrieved?.name).toBe('workflow-2');
      expect(retrieved?.description).toBe('Second workflow');
    });

    it('should be case-sensitive when retrieving workflows', () => {
      const workflow = WorkflowManager.create(
        workflowPath1,
        'TestWorkflow',
        'Test workflow',
        [],
        [],
        []
      );

      store.addWorkflow(workflow);

      expect(store.getWorkflow('TestWorkflow')).toBeDefined();
      expect(store.getWorkflow('testworkflow')).toBeUndefined();
      expect(store.getWorkflow('TESTWORKFLOW')).toBeUndefined();
    });
  });

  describe('getAllWorkflows()', () => {
    it('should return empty array for empty store', () => {
      const workflows = store.getAllWorkflows();
      expect(workflows).toEqual([]);
      expect(workflows).toHaveLength(0);
    });

    it('should return all workflows in the store', () => {
      const workflow1 = WorkflowManager.create(
        workflowPath1,
        'workflow-1',
        'First workflow',
        [],
        [],
        []
      );

      const workflow2 = WorkflowManager.create(
        workflowPath2,
        'workflow-2',
        'Second workflow',
        [],
        [],
        []
      );

      store.addWorkflow(workflow1);
      store.addWorkflow(workflow2);

      const workflows = store.getAllWorkflows();
      expect(workflows).toHaveLength(2);

      const names = workflows.map(w => w.name);
      expect(names).toContain('workflow-1');
      expect(names).toContain('workflow-2');
    });

    it('should return array of WorkflowManager instances', () => {
      const workflow = WorkflowManager.create(
        workflowPath1,
        'test-workflow',
        'Test workflow',
        [],
        [],
        []
      );

      store.addWorkflow(workflow);

      const workflows = store.getAllWorkflows();
      expect(workflows[0]).toBeInstanceOf(WorkflowManager);
      expect(workflows[0].name).toBe('test-workflow');
    });

    it('should return a new array each time', () => {
      const workflow = WorkflowManager.create(
        workflowPath1,
        'test-workflow',
        'Test workflow',
        [],
        [],
        []
      );

      store.addWorkflow(workflow);

      const workflows1 = store.getAllWorkflows();
      const workflows2 = store.getAllWorkflows();

      expect(workflows1).not.toBe(workflows2);
      expect(workflows1).toEqual(workflows2);
    });
  });

  describe('edge cases', () => {
    it('should handle workflow with empty name', () => {
      const workflow = WorkflowManager.create(
        workflowPath1,
        '',
        'Workflow with empty name',
        [],
        [],
        []
      );

      store.addWorkflow(workflow);

      const retrieved = store.getWorkflow('');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('');
    });

    it('should handle workflow with special characters in name', () => {
      const specialName = 'workflow-@#$%^&*()';
      const workflow = WorkflowManager.create(
        workflowPath1,
        specialName,
        'Workflow with special chars',
        [],
        [],
        []
      );

      store.addWorkflow(workflow);

      const retrieved = store.getWorkflow(specialName);
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe(specialName);
    });

    it('should handle workflow with unicode characters in name', () => {
      const unicodeName = '测试工作流';
      const workflow = WorkflowManager.create(
        workflowPath1,
        unicodeName,
        'Unicode workflow',
        [],
        [],
        []
      );

      store.addWorkflow(workflow);

      const retrieved = store.getWorkflow(unicodeName);
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe(unicodeName);
    });

    it('should handle many workflows in store', () => {
      const workflowCount = 100;

      for (let i = 0; i < workflowCount; i++) {
        const workflow = WorkflowManager.create(
          join(testDir, `workflow-${i}.yaml`),
          `workflow-${i}`,
          `Workflow number ${i}`,
          [],
          [],
          []
        );
        store.addWorkflow(workflow);
      }

      expect(store.getAllWorkflows()).toHaveLength(workflowCount);

      // Verify we can retrieve specific workflows
      const workflow50 = store.getWorkflow('workflow-50');
      expect(workflow50).toBeDefined();
      expect(workflow50?.description).toBe('Workflow number 50');
    });

    it('should maintain workflow identity after adding to store', () => {
      const steps: WorkflowAgentStep[] = [
        {
          id: 'step1',
          type: 'agent',
          name: 'Step 1',
          prompt: 'Test',
          outputs: [],
        },
      ];

      const workflow = WorkflowManager.create(
        workflowPath1,
        'identity-test',
        'Test workflow',
        [],
        [],
        steps
      );

      store.addWorkflow(workflow);
      const retrieved = store.getWorkflow('identity-test');

      // Verify all properties are preserved
      expect(retrieved?.name).toBe(workflow.name);
      expect(retrieved?.description).toBe(workflow.description);
      expect(retrieved?.version).toBe(workflow.version);
      expect(retrieved?.steps).toEqual(workflow.steps);
      expect(retrieved?.inputs).toEqual(workflow.inputs);
      expect(retrieved?.outputs).toEqual(workflow.outputs);
    });
  });

  describe('integration with WorkflowManager', () => {
    it('should work with workflows that have been saved and reloaded', () => {
      // Create and save a workflow
      const workflow = WorkflowManager.create(
        workflowPath1,
        'saved-workflow',
        'Workflow to be saved',
        [],
        [],
        []
      );
      workflow.save();

      // Load it into store
      store.loadWorkflow(workflowPath1);

      const retrieved = store.getWorkflow('saved-workflow');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('saved-workflow');
    });

    it('should handle workflow migration when loading', () => {
      const oldVersionYaml = `
name: old-version-workflow
description: Workflow without version
inputs: []
outputs: []
steps: []
`;

      writeFileSync(workflowPath1, oldVersionYaml, 'utf8');

      store.loadWorkflow(workflowPath1);

      const retrieved = store.getWorkflow('old-version-workflow');
      expect(retrieved).toBeDefined();
      expect(retrieved?.version).toBe('1.0'); // Should be migrated
    });

    it('should allow operations on retrieved workflows', () => {
      const steps: WorkflowAgentStep[] = [
        {
          id: 'step1',
          type: 'agent',
          name: 'Step 1',
          prompt: 'Test',
          outputs: [],
        },
      ];

      const workflow = WorkflowManager.create(
        workflowPath1,
        'operational-workflow',
        'Test workflow',
        [],
        [],
        steps
      );

      store.addWorkflow(workflow);

      const retrieved = store.getWorkflow('operational-workflow');
      expect(retrieved).toBeDefined();

      // Should be able to call WorkflowManager methods
      const step = retrieved!.getStep('step1');
      expect(step.id).toBe('step1');

      const tool = retrieved!.getStepTool('step1');
      expect(tool).toBe('claude');

      const model = retrieved!.getStepModel('step1');
      expect(model).toBe('claude-4-sonnet');
    });
  });
});
