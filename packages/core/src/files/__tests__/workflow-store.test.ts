import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowStore, WorkflowStoreError } from '../workflow-store.js';
import { WorkflowManager } from '../workflow.js';
import type { WorkflowAgentStep } from 'rover-schemas';
import { PROJECT_CONFIG_FILENAME } from 'rover-schemas';

// Mock the paths module
vi.mock('../../paths.js', () => ({
  getConfigDir: () => join(testConfigDir, '.rover', 'config'),
}));

// Mock the project-root module
let mockProjectRoot: string;
vi.mock('../../project-root.js', () => ({
  findProjectRoot: () => mockProjectRoot,
}));

let testConfigDir: string;
let testProjectDir: string;

describe('WorkflowStore', () => {
  let testDir: string;
  let workflowPath1: string;
  let workflowPath2: string;
  let store: WorkflowStore;

  beforeEach(() => {
    // Create temp directories for testing
    testDir = mkdtempSync(join(tmpdir(), 'workflow-store-test-'));
    testConfigDir = mkdtempSync(join(tmpdir(), 'workflow-manager-test-'));
    testProjectDir = mkdtempSync(join(tmpdir(), 'workflow-project-test-'));
    mockProjectRoot = testProjectDir;

    workflowPath1 = join(testDir, 'workflow1.yaml');
    workflowPath2 = join(testDir, 'workflow2.yaml');

    // Ensure .rover/config directory exists
    const configDir = join(testConfigDir, '.rover', 'config');
    mkdirSync(configDir, { recursive: true });

    store = new WorkflowStore();
  });

  afterEach(() => {
    // Clean up temp directories
    rmSync(testDir, { recursive: true, force: true });
    rmSync(testConfigDir, { recursive: true, force: true });
    rmSync(testProjectDir, { recursive: true, force: true });
    vi.restoreAllMocks();
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

  describe('constructor and store path selection', () => {
    it('should use central store when not in a Rover project', () => {
      const manager = new WorkflowStore();
      expect(manager.isInRoverProject()).toBe(false);
      expect(manager.getLocalStorePath()).toBeNull();
      expect(manager.getCentralStorePath()).toContain('workflows');
    });

    it('should use local store when in a Rover project', () => {
      // Create rover.json to simulate a Rover project
      writeFileSync(
        join(testProjectDir, PROJECT_CONFIG_FILENAME),
        '{}',
        'utf8'
      );

      const manager = new WorkflowStore();
      expect(manager.isInRoverProject()).toBe(true);
      expect(manager.getLocalStorePath()).toBe(
        join(testProjectDir, '.rover', 'workflows')
      );
    });

    it('should create workflows directory if it does not exist', () => {
      const manager = new WorkflowStore();
      const storePath = manager.getStorePath();
      expect(existsSync(storePath)).toBe(true);
    });
  });

  describe('add() - from local path', () => {
    it('should add a workflow from a local file', async () => {
      const workflowContent = `
version: '1.0'
name: test-workflow
description: Test workflow
inputs: []
outputs: []
steps: []
`;

      const sourcePath = join(testProjectDir, 'test-workflow.yml');
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStore();
      const result = await manager.add(sourcePath);

      expect(result.name).toBe('test-workflow');
      expect(result.isLocal).toBe(false); // Not in a Rover project
      expect(existsSync(result.path)).toBe(true);

      // Verify front matter was added
      const savedContent = readFileSync(result.path, 'utf8');
      expect(savedContent).toContain('# Rover Workflow Metadata');
      expect(savedContent).toContain(`# Source: ${sourcePath}`);
      expect(savedContent).toContain('# Imported At:');
      expect(savedContent).toContain('# Original Checksum:');
      expect(savedContent).toContain(workflowContent.trim());
    });

    it('should use custom name when provided', async () => {
      const workflowContent = `
version: '1.0'
name: original-name
description: Test workflow
inputs: []
outputs: []
steps: []
`;

      const sourcePath = join(testProjectDir, 'original.yml');
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStore();
      const result = await manager.add(sourcePath, 'custom-name');

      expect(result.name).toBe('custom-name');
      expect(result.path).toContain('custom-name.yml');

      // Verify the internal name field was updated in the saved workflow
      const savedContent = readFileSync(result.path, 'utf8');
      expect(savedContent).toContain('name: custom-name');
      expect(savedContent).not.toContain('name: original-name');
    });

    it('should update internal name field when custom name is provided for JSON workflow', async () => {
      // Test with JSON format (which is also valid YAML)
      const workflowContent = JSON.stringify(
        {
          version: '1.0',
          name: 'original-json-name',
          description: 'Test workflow in JSON format',
          inputs: [],
          outputs: [],
          steps: [],
        },
        null,
        2
      );

      const sourcePath = join(testProjectDir, 'json-workflow.yml');
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStore();
      const result = await manager.add(sourcePath, 'custom-json-name');

      expect(result.name).toBe('custom-json-name');
      expect(result.path).toContain('custom-json-name.yml');

      // Verify the internal name field was updated in the saved workflow
      const savedContent = readFileSync(result.path, 'utf8');
      // After front matter, should be converted to YAML format with updated name
      expect(savedContent).toContain('name: custom-json-name');
      expect(savedContent).not.toContain('name: original-json-name');
    });

    it('should extract name from file path', async () => {
      const workflowContent = `
version: '1.0'
name: workflow
description: Test
inputs: []
outputs: []
steps: []
`;

      const sourcePath = join(testProjectDir, 'my-awesome-workflow.yaml');
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStore();
      const result = await manager.add(sourcePath);

      expect(result.name).toBe('my-awesome-workflow');
    });

    it('should throw error when local file does not exist', async () => {
      const manager = new WorkflowStore();
      const nonExistentPath = join(testProjectDir, 'non-existent.yml');

      await expect(manager.add(nonExistentPath)).rejects.toThrow(
        WorkflowStoreError
      );
    });

    it('should throw error when workflow with same name already exists', async () => {
      const workflowContent = `
version: '1.0'
name: duplicate
description: Test
inputs: []
outputs: []
steps: []
`;

      const sourcePath = join(testProjectDir, 'duplicate.yml');
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStore();
      await manager.add(sourcePath);

      // Try to add again
      await expect(manager.add(sourcePath)).rejects.toThrow(
        /already exists in the store/
      );
    });
  });

  describe('add() - from URL', () => {
    it('should add a workflow from a URL', async () => {
      const workflowContent = `
version: '1.0'
name: remote-workflow
description: Remote workflow
inputs: []
outputs: []
steps: []
`;

      // Mock fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => workflowContent,
      } as Response);

      const manager = new WorkflowStore();
      const url = 'https://example.com/workflows/remote-workflow.yml';
      const result = await manager.add(url);

      expect(result.name).toBe('remote-workflow');
      expect(existsSync(result.path)).toBe(true);

      // Verify front matter was added
      const savedContent = readFileSync(result.path, 'utf8');
      expect(savedContent).toContain('# Rover Workflow Metadata');
      expect(savedContent).toContain(`# Source: ${url}`);
    });

    it('should extract name from URL', async () => {
      const workflowContent = `
version: '1.0'
name: workflow
description: Test
inputs: []
outputs: []
steps: []
`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => workflowContent,
      } as Response);

      const manager = new WorkflowStore();
      const url = 'https://example.com/path/to/swe-agent.yaml';
      const result = await manager.add(url);

      expect(result.name).toBe('swe-agent');
    });

    it('should handle URL without extension', async () => {
      const workflowContent = `
version: '1.0'
name: workflow
description: Test
inputs: []
outputs: []
steps: []
`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => workflowContent,
      } as Response);

      const manager = new WorkflowStore();
      const url = 'https://example.com/workflows/custom-workflow';
      const result = await manager.add(url);

      expect(result.name).toBe('custom-workflow');
    });

    it('should throw error when URL fetch fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      const manager = new WorkflowStore();
      const url = 'https://example.com/missing.yml';

      await expect(manager.add(url)).rejects.toThrow(WorkflowStoreError);
    });

    it('should throw error when network request fails', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const manager = new WorkflowStore();
      const url = 'https://example.com/workflow.yml';

      await expect(manager.add(url)).rejects.toThrow(WorkflowStoreError);
    });

    it('should throw error for invalid URL', async () => {
      const manager = new WorkflowStore();
      const invalidUrl = 'not-a-valid-url';

      await expect(manager.add(invalidUrl)).rejects.toThrow(WorkflowStoreError);
    });
  });

  describe('front matter handling', () => {
    it('should calculate correct checksum', async () => {
      const workflowContent = 'test content';
      const sourcePath = join(testProjectDir, 'test.yml');
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStore();
      const result = await manager.add(sourcePath);

      const savedContent = readFileSync(result.path, 'utf8');
      expect(savedContent).toContain('# Original Checksum:');

      // Verify checksum is a valid SHA256 hash (64 hex characters)
      const checksumMatch = savedContent.match(
        /# Original Checksum: ([a-f0-9]{64})/
      );
      expect(checksumMatch).not.toBeNull();
    });

    it('should add timestamp to front matter', async () => {
      const workflowContent = 'test content';
      const sourcePath = join(testProjectDir, 'test.yml');
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStore();
      const beforeAdd = new Date();
      const result = await manager.add(sourcePath);
      const afterAdd = new Date();

      const savedContent = readFileSync(result.path, 'utf8');
      const timestampMatch = savedContent.match(/# Imported At: (.+)/);
      expect(timestampMatch).not.toBeNull();

      const timestamp = new Date(timestampMatch![1]);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeAdd.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterAdd.getTime());
    });

    it('should preserve original content after front matter', async () => {
      const workflowContent = `version: '1.0'
name: test
description: Test workflow
inputs: []
outputs: []
steps: []`;

      const sourcePath = join(testProjectDir, 'test.yml');
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStore();
      const result = await manager.add(sourcePath);

      const savedContent = readFileSync(result.path, 'utf8');
      expect(savedContent).toContain(workflowContent);

      // Ensure content comes after front matter
      const parts = savedContent.split('# Rover Workflow Metadata');
      expect(parts).toHaveLength(2);
      expect(parts[1]).toContain(workflowContent);
    });
  });

  describe('parseFrontMatter()', () => {
    it('should parse front matter correctly', () => {
      const content = `# Rover Workflow Metadata
# Source: https://example.com/workflow.yml
# Imported At: 2024-01-01T00:00:00.000Z
# Original Checksum: abc123def456
#

version: '1.0'
name: test`;

      const result = WorkflowStore.parseFrontMatter(content);

      expect(result.metadata).not.toBeNull();
      expect(result.metadata?.source).toBe('https://example.com/workflow.yml');
      expect(result.metadata?.importedAt).toBe('2024-01-01T00:00:00.000Z');
      expect(result.metadata?.checksum).toBe('abc123def456');
      expect(result.content).toContain("version: '1.0'");
      expect(result.content).toContain('name: test');
    });

    it('should return null metadata for content without front matter', () => {
      const content = `version: '1.0'
name: test
description: Test workflow`;

      const result = WorkflowStore.parseFrontMatter(content);

      expect(result.metadata).toBeNull();
      expect(result.content).toBe(content);
    });

    it('should handle incomplete front matter', () => {
      const content = `# Rover Workflow Metadata
# Source: https://example.com/workflow.yml
# Imported At: 2024-01-01T00:00:00.000Z

version: '1.0'`;

      const result = WorkflowStore.parseFrontMatter(content);

      // Missing checksum, so metadata should be null
      expect(result.metadata).toBeNull();
    });

    it('should handle front matter with extra comments', () => {
      const content = `# Rover Workflow Metadata
# Source: https://example.com/workflow.yml
# Some other comment
# Imported At: 2024-01-01T00:00:00.000Z
# Another comment
# Original Checksum: abc123
#

version: '1.0'`;

      const result = WorkflowStore.parseFrontMatter(content);

      expect(result.metadata).not.toBeNull();
      expect(result.metadata?.source).toBe('https://example.com/workflow.yml');
      expect(result.metadata?.checksum).toBe('abc123');
    });
  });

  describe('local vs central store behavior', () => {
    it('should save to local store when in a Rover project', async () => {
      // Create rover.json to simulate a Rover project
      writeFileSync(
        join(testProjectDir, PROJECT_CONFIG_FILENAME),
        '{}',
        'utf8'
      );

      const workflowContent = `
version: '1.0'
name: local-workflow
description: Test
inputs: []
outputs: []
steps: []
`;

      const sourcePath = join(testProjectDir, 'local.yml');
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStore();
      const result = await manager.add(sourcePath);

      expect(result.isLocal).toBe(true);
      expect(result.path).toContain('.rover/workflows');
      expect(result.path).toContain(testProjectDir);
    });

    it('should save to central store when not in a Rover project', async () => {
      const workflowContent = `
version: '1.0'
name: central-workflow
description: Test
inputs: []
outputs: []
steps: []
`;

      const sourcePath = join(testProjectDir, 'central.yml');
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStore();
      const result = await manager.add(sourcePath);

      expect(result.isLocal).toBe(false);
      expect(result.path).toContain('config/workflows');
    });
  });

  describe('edge cases', () => {
    it('should handle workflow with special characters in filename', async () => {
      const workflowContent = `
version: '1.0'
name: workflow
description: Test
inputs: []
outputs: []
steps: []
`;

      const sourcePath = join(testProjectDir, 'my-special_workflow@v2.yml');
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStore();
      const result = await manager.add(sourcePath);

      expect(result.name).toBe('my-special_workflow@v2');
    });

    it('should handle very long workflow names', async () => {
      const longName = 'a'.repeat(200);
      const workflowContent = `
version: '1.0'
name: workflow
description: Test
inputs: []
outputs: []
steps: []
`;

      const sourcePath = join(testProjectDir, `${longName}.yml`);
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStore();
      const result = await manager.add(sourcePath, longName);

      expect(result.name).toBe(longName);
    });

    it('should handle empty workflow content', async () => {
      const workflowContent = '';
      const sourcePath = join(testProjectDir, 'empty.yml');
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStore();
      const result = await manager.add(sourcePath);

      expect(result.name).toBe('empty');
      expect(existsSync(result.path)).toBe(true);

      // Should still have front matter
      const savedContent = readFileSync(result.path, 'utf8');
      expect(savedContent).toContain('# Rover Workflow Metadata');
    });

    it('should handle workflow content with existing comments', async () => {
      const workflowContent = `# This is a comment
# Another comment
version: '1.0'
name: commented-workflow
description: Test
inputs: []
outputs: []
steps: []`;

      const sourcePath = join(testProjectDir, 'commented.yml');
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStore();
      const result = await manager.add(sourcePath);

      const savedContent = readFileSync(result.path, 'utf8');
      expect(savedContent).toContain('# Rover Workflow Metadata');
      expect(savedContent).toContain('# This is a comment');
      expect(savedContent).toContain('# Another comment');
    });

    it('should handle nested directory paths', async () => {
      const workflowContent = `
version: '1.0'
name: workflow
description: Test
inputs: []
outputs: []
steps: []
`;

      // Create a nested directory structure
      const nestedDir = join(testProjectDir, 'deeply', 'nested', 'directory');
      mkdirSync(nestedDir, { recursive: true });
      const sourcePath = join(nestedDir, 'workflow.yml');
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStore();
      const result = await manager.add(sourcePath);

      expect(result.name).toBe('workflow');
      expect(existsSync(result.path)).toBe(true);
    });
  });
});
