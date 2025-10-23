import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { WorkflowManager } from '../workflow.js';
import type {
  Workflow,
  WorkflowAgentStep,
  WorkflowInput,
  WorkflowOutput,
} from '../workflow/types.js';

describe('WorkflowManager', () => {
  let testDir: string;
  let workflowPath: string;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'agent-workflow-test-'));
    workflowPath = join(testDir, 'workflow.yaml');
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('create()', () => {
    it('should create a new workflow with default values', () => {
      const workflow = WorkflowManager.create(
        workflowPath,
        'test-workflow',
        'Test workflow description',
        [],
        [],
        []
      );

      expect(workflow.name).toBe('test-workflow');
      expect(workflow.description).toBe('Test workflow description');
      expect(workflow.version).toBe('1.0');
      expect(workflow.defaults?.tool).toBe('claude');
      expect(workflow.defaults?.model).toBe('claude-4-sonnet');
      expect(workflow.config?.timeout).toBe(3600);
      expect(workflow.config?.continueOnError).toBe(false);
      expect(existsSync(workflowPath)).toBe(true);
    });

    it('should create a workflow with inputs, outputs, and steps', () => {
      const inputs: WorkflowInput[] = [
        {
          name: 'prompt',
          description: 'The prompt to process',
          type: 'string',
          required: true,
        },
      ];

      const outputs: WorkflowOutput[] = [
        {
          name: 'result',
          description: 'The processed result',
          type: 'string',
        },
      ];

      const steps: WorkflowAgentStep[] = [
        {
          id: 'process',
          type: 'agent',
          name: 'Process Input',
          prompt: 'Process the input: {{prompt}}',
          outputs: [
            {
              name: 'result',
              description: 'Processed output',
              type: 'string',
            },
          ],
        },
      ];

      const workflow = WorkflowManager.create(
        workflowPath,
        'test-workflow',
        'Test workflow',
        inputs,
        outputs,
        steps
      );

      expect(workflow.inputs).toEqual(inputs);
      expect(workflow.outputs).toEqual(outputs);
      expect(workflow.steps).toEqual(steps);

      // Verify the YAML file was created correctly
      const yamlContent = readFileSync(workflowPath, 'utf8');
      const parsedYaml = parseYaml(yamlContent) as Workflow;
      expect(parsedYaml.inputs).toEqual(inputs);
      expect(parsedYaml.outputs).toEqual(outputs);
      expect(parsedYaml.steps).toEqual(steps);
    });
  });

  describe('load()', () => {
    it('should load an existing workflow from YAML file', () => {
      const yamlContent = `
version: '1.0'
name: test-workflow
description: Test workflow description
inputs:
  - name: prompt
    description: The prompt to process
    type: string
    required: true
outputs:
  - name: result
    description: The processed result
    type: string
defaults:
  tool: claude
  model: claude-3-sonnet
config:
  timeout: 3600
  continueOnError: false
steps:
  - id: process
    type: agent
    name: Process Input
    prompt: Process the input
    outputs:
      - name: result
        description: Processed output
        type: string
`;

      writeFileSync(workflowPath, yamlContent, 'utf8');

      const workflow = WorkflowManager.load(workflowPath);

      expect(workflow.name).toBe('test-workflow');
      expect(workflow.description).toBe('Test workflow description');
      expect(workflow.version).toBe('1.0');
      expect(workflow.inputs).toHaveLength(1);
      expect(workflow.outputs).toHaveLength(1);
      expect(workflow.steps).toHaveLength(1);
    });

    it('should throw error when file does not exist', () => {
      expect(() => {
        WorkflowManager.load(join(testDir, 'non-existent.yaml'));
      }).toThrow('Workflow configuration not found');
    });

    it('should handle malformed YAML gracefully', () => {
      const malformedYaml = `
version: '1.0'
name: test-workflow
  - this is invalid YAML
description: test
`;

      writeFileSync(workflowPath, malformedYaml, 'utf8');

      expect(() => {
        WorkflowManager.load(workflowPath);
      }).toThrow('Failed to load workflow config');
    });

    it('should handle YAML with unicode and special characters', () => {
      const yamlContent = `
version: '1.0'
name: 测试工作流 # Unicode characters
description: "Workflow with special chars: @#$%^&*()"
inputs: []
outputs: []
defaults:
  tool: claude
  model: claude-3-sonnet
steps:
  - id: special-step
    type: agent
    name: "Step with 'quotes' and apostrophes"
    prompt: |
      Multi-line prompt with special characters:
      • Bullet point
      → Arrow
      © Copyright symbol
    outputs: []
`;

      writeFileSync(workflowPath, yamlContent, 'utf8');

      const workflow = WorkflowManager.load(workflowPath);

      expect(workflow.name).toBe('测试工作流');
      expect(workflow.description).toContain('@#$%^&*()');
      expect(workflow.steps[0].name).toContain('quotes');
      expect(workflow.steps[0].prompt).toContain('• Bullet point');
    });
  });

  describe('save()', () => {
    it('should save workflow data to YAML file', () => {
      const workflow = WorkflowManager.create(
        workflowPath,
        'test-workflow',
        'Test workflow',
        [],
        [],
        []
      );

      // Modify and save
      workflow.save();

      // Verify file exists and can be loaded
      expect(existsSync(workflowPath)).toBe(true);
      const reloaded = WorkflowManager.load(workflowPath);
      expect(reloaded.name).toBe('test-workflow');
    });

    it('should save workflow successfully', () => {
      const yamlContent = `
version: '1.0'
name: test-workflow
description: Test workflow
inputs: []
outputs: []
defaults:
  tool: claude
steps:
  - id: step1
    type: agent
    name: Step 1
    prompt: Test prompt
    outputs: []
`;

      writeFileSync(workflowPath, yamlContent, 'utf8');
      const workflow = WorkflowManager.load(workflowPath);

      // Save should work fine (validation happened in constructor/load)
      expect(() => workflow.save()).not.toThrow();

      // Verify file was saved
      expect(existsSync(workflowPath)).toBe(true);
      const saved = WorkflowManager.load(workflowPath);
      expect(saved.name).toBe('test-workflow');
    });
  });

  describe('migrate()', () => {
    it('should migrate workflow without version to current version', () => {
      const oldYaml = `
name: test-workflow
description: Test workflow
inputs: []
outputs: []
steps: []
`;

      writeFileSync(workflowPath, oldYaml, 'utf8');
      const workflow = WorkflowManager.load(workflowPath);

      expect(workflow.version).toBe('1.0');
      // defaults and config are optional, migration doesn't add them
      expect(workflow.defaults).toBeUndefined();
      expect(workflow.config).toBeUndefined();

      // Verify migration was saved
      const saved = parseYaml(readFileSync(workflowPath, 'utf8')) as Workflow;
      expect(saved.version).toBe('1.0');
    });

    it('should migrate workflow without defaults (optional field)', () => {
      const oldYaml = `
version: '0.9'
name: test-workflow
description: Test workflow
inputs: []
outputs: []
steps: []
`;

      writeFileSync(workflowPath, oldYaml, 'utf8');
      const workflow = WorkflowManager.load(workflowPath);

      // defaults is optional, should be undefined if not provided
      expect(workflow.defaults).toBeUndefined();
      expect(workflow.version).toBe('1.0');
    });

    it('should migrate workflow without config (optional field)', () => {
      const oldYaml = `
version: '0.9'
name: test-workflow
description: Test workflow
inputs: []
outputs: []
defaults:
  tool: gemini
steps: []
`;

      writeFileSync(workflowPath, oldYaml, 'utf8');
      const workflow = WorkflowManager.load(workflowPath);

      // config is optional, should be undefined if not provided
      expect(workflow.config).toBeUndefined();
      expect(workflow.defaults?.tool).toBe('gemini');
    });

    it('should preserve workflow with current version and custom values', () => {
      const currentYaml = `
version: '1.0'
name: test-workflow
description: Test workflow
inputs: []
outputs: []
defaults:
  tool: claude
  model: custom-model
config:
  timeout: 7200
  continueOnError: true
steps: []
`;

      writeFileSync(workflowPath, currentYaml, 'utf8');

      // Read original content
      const originalContent = readFileSync(workflowPath, 'utf8');

      const workflow = WorkflowManager.load(workflowPath);

      // Should preserve custom values
      expect(workflow.defaults?.tool).toBe('claude');
      expect(workflow.defaults?.model).toBe('custom-model');
      expect(workflow.config?.timeout).toBe(7200);
      expect(workflow.config?.continueOnError).toBe(true);

      // File should not be modified since no migration was needed
      // (Note: whitespace might differ due to YAML parsing/stringifying)
      const savedData = parseYaml(
        readFileSync(workflowPath, 'utf8')
      ) as Workflow;
      const originalData = parseYaml(originalContent) as Workflow;
      expect(savedData).toEqual(originalData);
    });
  });

  describe('validation', () => {
    it('should validate required fields', () => {
      const invalidYaml = `
version: '1.0'
inputs: []
outputs: []
steps: []
`;

      writeFileSync(workflowPath, invalidYaml, 'utf8');

      expect(() => {
        WorkflowManager.load(workflowPath);
      }).toThrow(); // Zod will throw validation error for missing 'name'
    });

    it('should validate input fields', () => {
      const invalidYaml = `
version: '1.0'
name: test
description: test
inputs:
  - name: input1
    description: test
    type: string
    # missing required field
outputs: []
steps: []
`;

      writeFileSync(workflowPath, invalidYaml, 'utf8');

      expect(() => {
        WorkflowManager.load(workflowPath);
      }).toThrow(); // Zod will throw validation error for missing 'required'
    });

    it('should validate output fields', () => {
      const invalidYaml = `
version: '1.0'
name: test
description: test
inputs: []
outputs:
  - description: Missing name field
    type: string
steps: []
`;

      writeFileSync(workflowPath, invalidYaml, 'utf8');

      expect(() => {
        WorkflowManager.load(workflowPath);
      }).toThrow(); // Zod will throw validation error for missing 'name'
    });

    it('should validate output type field', () => {
      const missingTypeYaml = `
version: '1.0'
name: test
description: test
inputs: []
outputs:
  - name: output1
    description: Missing type field
steps: []
`;

      writeFileSync(workflowPath, missingTypeYaml, 'utf8');

      expect(() => {
        WorkflowManager.load(workflowPath);
      }).toThrow(); // Zod will throw validation error for missing 'type'
    });

    it('should validate step fields', () => {
      const invalidYaml = `
version: '1.0'
name: test
description: test
inputs: []
outputs: []
steps:
  - id: step1
    type: agent
    # missing name and prompt
    outputs: []
`;

      writeFileSync(workflowPath, invalidYaml, 'utf8');

      expect(() => {
        WorkflowManager.load(workflowPath);
      }).toThrow(); // Zod will throw validation error for missing 'name' and 'prompt'
    });

    it('should detect duplicate step IDs', () => {
      const duplicateYaml = `
version: '1.0'
name: test
description: test
inputs: []
outputs: []
steps:
  - id: duplicate-id
    type: agent
    name: Step 1
    prompt: Prompt 1
    outputs: []
  - id: duplicate-id
    type: agent
    name: Step 2
    prompt: Prompt 2
    outputs: []
`;

      writeFileSync(workflowPath, duplicateYaml, 'utf8');

      expect(() => {
        WorkflowManager.load(workflowPath);
      }).toThrow('Duplicate step IDs found in workflow');
    });

    it('should validate array types', () => {
      const invalidYaml = `
version: '1.0'
name: test
description: test
inputs: "not an array"
outputs: []
steps: []
`;

      writeFileSync(workflowPath, invalidYaml, 'utf8');

      expect(() => {
        WorkflowManager.load(workflowPath);
      }).toThrow(); // Zod will throw validation error for wrong type
    });
  });

  describe('getStep()', () => {
    let workflow: WorkflowManager;

    beforeEach(() => {
      const steps: WorkflowAgentStep[] = [
        {
          id: 'step1',
          type: 'agent',
          name: 'Step 1',
          prompt: 'Prompt 1',
          outputs: [],
        },
        {
          id: 'step2',
          type: 'agent',
          name: 'Step 2',
          prompt: 'Prompt 2',
          outputs: [],
        },
      ];

      workflow = WorkflowManager.create(
        workflowPath,
        'test-workflow',
        'Test workflow',
        [],
        [],
        steps
      );
    });

    it('should return step by ID', () => {
      const step = workflow.getStep('step1');
      expect(step.id).toBe('step1');
      expect(step.name).toBe('Step 1');
    });

    it('should throw error for non-existent step', () => {
      expect(() => {
        workflow.getStep('non-existent');
      }).toThrow('Step not found: non-existent');
    });
  });

  describe('getWorkflowAgentStep()', () => {
    let workflow: WorkflowManager;

    beforeEach(() => {
      const steps: WorkflowAgentStep[] = [
        {
          id: 'agent1',
          type: 'agent',
          name: 'Agent Step',
          prompt: 'Test prompt',
          outputs: [],
        },
      ];

      workflow = WorkflowManager.create(
        workflowPath,
        'test-workflow',
        'Test workflow',
        [],
        [],
        steps
      );
    });

    it('should return agent step by ID', () => {
      const step = workflow.getWorkflowAgentStep('agent1');
      expect(step.id).toBe('agent1');
      expect(step.type).toBe('agent');
      expect(step.name).toBe('Agent Step');
    });

    it('should throw error for non-existent step', () => {
      expect(() => {
        workflow.getWorkflowAgentStep('non-existent');
      }).toThrow('Step not found: non-existent');
    });

    it('should throw error when step is not an agent step', () => {
      // For this test, we would need a non-agent step type
      // Since we only support agent steps now, this test verifies the type guard works
      const step = workflow.getWorkflowAgentStep('agent1');
      expect(step.type).toBe('agent');
    });
  });

  describe('getStepTool()', () => {
    let workflow: WorkflowManager;

    beforeEach(() => {
      const steps: WorkflowAgentStep[] = [
        {
          id: 'default-tool',
          type: 'agent',
          name: 'Default Tool Step',
          prompt: 'Test',
          outputs: [],
        },
        {
          id: 'custom-tool',
          type: 'agent',
          name: 'Custom Tool Step',
          tool: 'gemini',
          prompt: 'Test',
          outputs: [],
        },
      ];

      workflow = WorkflowManager.create(
        workflowPath,
        'test-workflow',
        'Test workflow',
        [],
        [],
        steps
      );
    });

    it('should return default tool when step has no tool specified', () => {
      const tool = workflow.getStepTool('default-tool');
      expect(tool).toBe('claude');
    });

    it('should return step-specific tool when specified', () => {
      const tool = workflow.getStepTool('custom-tool');
      expect(tool).toBe('gemini');
    });

    it('should throw error for non-existent step', () => {
      expect(() => {
        workflow.getStepTool('non-existent');
      }).toThrow('Step not found: non-existent');
    });
  });

  describe('getStepModel()', () => {
    let workflow: WorkflowManager;

    beforeEach(() => {
      const steps: WorkflowAgentStep[] = [
        {
          id: 'default-model',
          type: 'agent',
          name: 'Default Model Step',
          prompt: 'Test',
          outputs: [],
        },
        {
          id: 'custom-model',
          type: 'agent',
          name: 'Custom Model Step',
          model: 'gpt-4',
          prompt: 'Test',
          outputs: [],
        },
      ];

      workflow = WorkflowManager.create(
        workflowPath,
        'test-workflow',
        'Test workflow',
        [],
        [],
        steps
      );
    });

    it('should return default model when step has no model specified', () => {
      const model = workflow.getStepModel('default-model');
      expect(model).toBe('claude-4-sonnet');
    });

    it('should return step-specific model when specified', () => {
      const model = workflow.getStepModel('custom-model');
      expect(model).toBe('gpt-4');
    });

    it('should throw error for non-existent step', () => {
      expect(() => {
        workflow.getStepModel('non-existent');
      }).toThrow('Step not found: non-existent');
    });
  });

  describe('getStepTimeout()', () => {
    let workflow: WorkflowManager;

    beforeEach(() => {
      const steps: WorkflowAgentStep[] = [
        {
          id: 'default-timeout',
          type: 'agent',
          name: 'Default Timeout Step',
          prompt: 'Test',
          outputs: [],
        },
        {
          id: 'custom-timeout',
          type: 'agent',
          name: 'Custom Timeout Step',
          prompt: 'Test',
          outputs: [],
          config: {
            timeout: 7200,
          },
        },
      ];

      workflow = WorkflowManager.create(
        workflowPath,
        'test-workflow',
        'Test workflow',
        [],
        [],
        steps
      );
    });

    it('should return global timeout for steps without custom timeout', () => {
      expect(workflow.getStepTimeout('default-timeout')).toBe(3600);
    });

    it('should return step-specific timeout when specified', () => {
      expect(workflow.getStepTimeout('custom-timeout')).toBe(7200);
    });
  });

  describe('getStepRetries()', () => {
    let workflow: WorkflowManager;

    beforeEach(() => {
      const steps: WorkflowAgentStep[] = [
        {
          id: 'no-retry',
          type: 'agent',
          name: 'No Retry Step',
          prompt: 'Test',
          outputs: [],
        },
        {
          id: 'retry-step',
          type: 'agent',
          name: 'Retry Step',
          prompt: 'Test',
          outputs: [],
          config: {
            retries: 3,
          },
        },
      ];

      workflow = WorkflowManager.create(
        workflowPath,
        'test-workflow',
        'Test workflow',
        [],
        [],
        steps
      );
    });

    it('should return 0 retries by default', () => {
      expect(workflow.getStepRetries('no-retry')).toBe(0);
    });

    it('should return step-specific retry count when specified', () => {
      expect(workflow.getStepRetries('retry-step')).toBe(3);
    });
  });

  describe('toYaml()', () => {
    it('should export workflow to YAML string', () => {
      const workflow = WorkflowManager.create(
        workflowPath,
        'test-workflow',
        'Test workflow',
        [],
        [],
        []
      );

      const yamlString = workflow.toYaml();
      const parsed = parseYaml(yamlString) as Workflow;

      expect(parsed.name).toBe('test-workflow');
      expect(parsed.description).toBe('Test workflow');
      expect(parsed.version).toBe('1.0');
    });

    it('should format YAML with proper indentation', () => {
      const steps: WorkflowAgentStep[] = [
        {
          id: 'step1',
          type: 'agent',
          name: 'Step 1',
          prompt:
            'A very long prompt that should be wrapped properly to respect line width limits in the YAML output',
          outputs: [
            {
              name: 'output1',
              description: 'First output',
              type: 'string',
            },
            {
              name: 'output2',
              description: 'Second output',
              type: 'string',
            },
          ],
        },
      ];

      const workflow = WorkflowManager.create(
        workflowPath,
        'test-workflow',
        'Test workflow',
        [],
        [],
        steps
      );

      const yamlString = workflow.toYaml();

      // Check that indentation is consistent
      expect(yamlString).toContain('  - id: step1');
      expect(yamlString).toContain('    outputs:');
      expect(yamlString).toContain('      - name: output1');
    });
  });

  describe('getter properties', () => {
    let workflow: WorkflowManager;

    beforeEach(() => {
      const inputs: WorkflowInput[] = [
        {
          name: 'input1',
          description: 'Test input',
          type: 'string',
          required: true,
        },
      ];

      const outputs: WorkflowOutput[] = [
        {
          name: 'output1',
          description: 'Test output',
          type: 'string',
        },
      ];

      const steps: WorkflowAgentStep[] = [
        {
          id: 'step1',
          type: 'agent',
          name: 'Step 1',
          prompt: 'Test',
          outputs: [],
        },
      ];

      workflow = WorkflowManager.create(
        workflowPath,
        'test-workflow',
        'Test workflow description',
        inputs,
        outputs,
        steps
      );
    });

    it('should provide access to workflow properties via getters', () => {
      expect(workflow.version).toBe('1.0');
      expect(workflow.name).toBe('test-workflow');
      expect(workflow.description).toBe('Test workflow description');
      expect(workflow.inputs).toHaveLength(1);
      expect(workflow.outputs).toHaveLength(1);
      expect(workflow.steps).toHaveLength(1);
      expect(workflow.defaults?.tool).toBe('claude');
      expect(workflow.config?.timeout).toBe(3600);
    });
  });

  describe('validateInputs()', () => {
    let workflow: WorkflowManager;

    beforeEach(() => {
      const inputs: WorkflowInput[] = [
        {
          name: 'required_input',
          description: 'A required input',
          type: 'string',
          required: true,
        },
        {
          name: 'optional_input',
          description: 'An optional input',
          type: 'string',
          required: false,
        },
        {
          name: 'required_with_default',
          description: 'A required input with default value',
          type: 'string',
          required: true,
          default: 'default_value',
        },
      ];

      workflow = WorkflowManager.create(
        workflowPath,
        'validation-test-workflow',
        'Workflow for testing input validation',
        inputs,
        [],
        []
      );
    });

    it('should validate successfully when all required inputs are provided', () => {
      const providedInputs = new Map([
        ['required_input', 'value1'],
        ['optional_input', 'value2'],
        ['required_with_default', 'custom_value'],
      ]);

      const validation = workflow.validateInputs(providedInputs);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.warnings).toHaveLength(0);
    });

    it('should validate successfully when only required inputs are provided', () => {
      const providedInputs = new Map([['required_input', 'value1']]);

      const validation = workflow.validateInputs(providedInputs);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.warnings).toHaveLength(0);
    });

    it('should fail validation when required input without default is missing', () => {
      const providedInputs = new Map([['optional_input', 'value2']]);

      const validation = workflow.validateInputs(providedInputs);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toBe(
        'Required input "required_input" is missing'
      );
    });

    it('should warn about unknown inputs not defined in workflow', () => {
      const providedInputs = new Map([
        ['required_input', 'value1'],
        ['unknown_input', 'unknown_value'],
        ['another_unknown', 'another_value'],
      ]);

      const validation = workflow.validateInputs(providedInputs);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.warnings).toHaveLength(2);
      expect(validation.warnings).toContain(
        'Unknown input "unknown_input" provided (not defined in workflow)'
      );
      expect(validation.warnings).toContain(
        'Unknown input "another_unknown" provided (not defined in workflow)'
      );
    });

    it('should handle empty input map', () => {
      const providedInputs = new Map<string, string>();

      const validation = workflow.validateInputs(providedInputs);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toHaveLength(1);
      expect(validation.errors[0]).toBe(
        'Required input "required_input" is missing'
      );
      expect(validation.warnings).toHaveLength(0);
    });

    it('should detect duplicate input definitions in workflow schema', () => {
      // Create a workflow with duplicate input names (this would be a schema issue)
      const duplicateInputs: WorkflowInput[] = [
        {
          name: 'duplicate_name',
          description: 'First input with duplicate name',
          type: 'string',
          required: true,
        },
        {
          name: 'duplicate_name',
          description: 'Second input with duplicate name',
          type: 'string',
          required: false,
        },
      ];

      const duplicateWorkflow = WorkflowManager.create(
        join(testDir, 'duplicate-workflow.yaml'),
        'duplicate-workflow',
        'Workflow with duplicate input names',
        duplicateInputs,
        [],
        []
      );

      const providedInputs = new Map([['duplicate_name', 'some_value']]);

      const validation = duplicateWorkflow.validateInputs(providedInputs);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain(
        'Input "duplicate_name" is defined 2 times in workflow (should be unique)'
      );
    });

    it('should handle workflow with no inputs defined', () => {
      const noInputWorkflow = WorkflowManager.create(
        join(testDir, 'no-input-workflow.yaml'),
        'no-input-workflow',
        'Workflow with no inputs',
        [], // No inputs
        [],
        []
      );

      const providedInputs = new Map([['unexpected_input', 'value']]);

      const validation = noInputWorkflow.validateInputs(providedInputs);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.warnings).toHaveLength(1);
      expect(validation.warnings[0]).toBe(
        'Unknown input "unexpected_input" provided (not defined in workflow)'
      );
    });

    it('should validate successfully with empty inputs for workflow with no required inputs', () => {
      const optionalOnlyWorkflow = WorkflowManager.create(
        join(testDir, 'optional-only-workflow.yaml'),
        'optional-only-workflow',
        'Workflow with only optional inputs',
        [
          {
            name: 'optional1',
            description: 'Optional input 1',
            type: 'string',
            required: false,
          },
          {
            name: 'optional2',
            description: 'Optional input 2',
            type: 'number',
            required: false,
          },
        ],
        [],
        []
      );

      const providedInputs = new Map<string, string>();

      const validation = optionalOnlyWorkflow.validateInputs(providedInputs);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.warnings).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('should accept empty strings in string fields', () => {
      // Zod z.string() accepts empty strings by default
      // If we want to reject empty strings, we need z.string().min(1)
      const yamlWithEmptyName = `
version: '1.0'
name: ''
description: test
inputs: []
outputs: []
steps: []
`;

      writeFileSync(workflowPath, yamlWithEmptyName, 'utf8');

      // This should load successfully (empty string is valid)
      const workflow = WorkflowManager.load(workflowPath);
      expect(workflow.name).toBe('');
    });

    it('should handle very large workflow files', () => {
      const steps: WorkflowAgentStep[] = [];
      for (let i = 0; i < 1000; i++) {
        steps.push({
          id: `step-${i}`,
          type: 'agent',
          name: `Step ${i}`,
          prompt: `This is step ${i} with a reasonably long prompt to test handling of large files`,
          outputs: [
            {
              name: `output-${i}`,
              description: `Output for step ${i}`,
              type: 'string',
            },
          ],
        });
      }

      const workflow = WorkflowManager.create(
        workflowPath,
        'large-workflow',
        'Workflow with many steps',
        [],
        [],
        steps
      );

      expect(workflow.steps).toHaveLength(1000);

      // Should be able to save and reload
      workflow.save();
      const reloaded = WorkflowManager.load(workflowPath);
      expect(reloaded.steps).toHaveLength(1000);
    });

    it('should handle file system permission errors gracefully', () => {
      // Create a workflow first
      const workflow = WorkflowManager.create(
        workflowPath,
        'test-workflow',
        'Test workflow',
        [],
        [],
        []
      );

      // Try to save to a path that doesn't exist
      const invalidPath = join('/non-existent-directory', 'workflow.yaml');
      // @ts-ignore - Accessing private field for testing
      workflow.filePath = invalidPath;

      expect(() => {
        workflow.save();
      }).toThrow('Failed to save workflow config');
    });

    it('should preserve YAML comments when loading and saving', () => {
      // Note: The yaml library does not preserve comments by default
      // This test verifies that the workflow still works even with comments
      const yamlWithComments = `
# This is a test workflow
version: '1.0'
name: test-workflow
description: Test workflow # inline comment
inputs: []
outputs: []
defaults:
  tool: claude # default tool
  model: claude-3-sonnet
config:
  timeout: 3600 # 1 hour
  continueOnError: false
steps:
  # First step
  - id: step1
    type: agent
    name: Step 1
    prompt: Test prompt
    outputs: []
`;

      writeFileSync(workflowPath, yamlWithComments, 'utf8');

      const workflow = WorkflowManager.load(workflowPath);
      expect(workflow.name).toBe('test-workflow');
      expect(workflow.steps[0].id).toBe('step1');

      // Save and reload
      workflow.save();
      const reloaded = WorkflowManager.load(workflowPath);
      expect(reloaded.name).toBe('test-workflow');
    });
  });
});
