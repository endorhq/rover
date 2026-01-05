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
import {
  WorkflowStoreManager,
  WorkflowStoreManagerError,
} from '../workflow-store-manager.js';
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

describe('WorkflowStoreManager', () => {
  beforeEach(() => {
    // Create temp directories for testing
    testConfigDir = mkdtempSync(join(tmpdir(), 'workflow-manager-test-'));
    testProjectDir = mkdtempSync(join(tmpdir(), 'workflow-project-test-'));
    mockProjectRoot = testProjectDir;

    // Ensure .rover/config directory exists
    const configDir = join(testConfigDir, '.rover', 'config');
    mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directories
    rmSync(testConfigDir, { recursive: true, force: true });
    rmSync(testProjectDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('constructor and store path selection', () => {
    it('should use central store when not in a Rover project', () => {
      const manager = new WorkflowStoreManager();
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

      const manager = new WorkflowStoreManager();
      expect(manager.isInRoverProject()).toBe(true);
      expect(manager.getLocalStorePath()).toBe(
        join(testProjectDir, '.rover', 'workflows')
      );
    });

    it('should create workflows directory if it does not exist', () => {
      const manager = new WorkflowStoreManager();
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

      const manager = new WorkflowStoreManager();
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

      const manager = new WorkflowStoreManager();
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

      const manager = new WorkflowStoreManager();
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

      const manager = new WorkflowStoreManager();
      const result = await manager.add(sourcePath);

      expect(result.name).toBe('my-awesome-workflow');
    });

    it('should throw error when local file does not exist', async () => {
      const manager = new WorkflowStoreManager();
      const nonExistentPath = join(testProjectDir, 'non-existent.yml');

      await expect(manager.add(nonExistentPath)).rejects.toThrow(
        WorkflowStoreManagerError
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

      const manager = new WorkflowStoreManager();
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

      const manager = new WorkflowStoreManager();
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

      const manager = new WorkflowStoreManager();
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

      const manager = new WorkflowStoreManager();
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

      const manager = new WorkflowStoreManager();
      const url = 'https://example.com/missing.yml';

      await expect(manager.add(url)).rejects.toThrow(WorkflowStoreManagerError);
    });

    it('should throw error when network request fails', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const manager = new WorkflowStoreManager();
      const url = 'https://example.com/workflow.yml';

      await expect(manager.add(url)).rejects.toThrow(WorkflowStoreManagerError);
    });

    it('should throw error for invalid URL', async () => {
      const manager = new WorkflowStoreManager();
      const invalidUrl = 'not-a-valid-url';

      await expect(manager.add(invalidUrl)).rejects.toThrow(
        WorkflowStoreManagerError
      );
    });
  });

  describe('front matter handling', () => {
    it('should calculate correct checksum', async () => {
      const workflowContent = 'test content';
      const sourcePath = join(testProjectDir, 'test.yml');
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStoreManager();
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

      const manager = new WorkflowStoreManager();
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

      const manager = new WorkflowStoreManager();
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

      const result = WorkflowStoreManager.parseFrontMatter(content);

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

      const result = WorkflowStoreManager.parseFrontMatter(content);

      expect(result.metadata).toBeNull();
      expect(result.content).toBe(content);
    });

    it('should handle incomplete front matter', () => {
      const content = `# Rover Workflow Metadata
# Source: https://example.com/workflow.yml
# Imported At: 2024-01-01T00:00:00.000Z

version: '1.0'`;

      const result = WorkflowStoreManager.parseFrontMatter(content);

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

      const result = WorkflowStoreManager.parseFrontMatter(content);

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

      const manager = new WorkflowStoreManager();
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

      const manager = new WorkflowStoreManager();
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

      const manager = new WorkflowStoreManager();
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

      const manager = new WorkflowStoreManager();
      const result = await manager.add(sourcePath, longName);

      expect(result.name).toBe(longName);
    });

    it('should handle empty workflow content', async () => {
      const workflowContent = '';
      const sourcePath = join(testProjectDir, 'empty.yml');
      writeFileSync(sourcePath, workflowContent, 'utf8');

      const manager = new WorkflowStoreManager();
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

      const manager = new WorkflowStoreManager();
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

      const manager = new WorkflowStoreManager();
      const result = await manager.add(sourcePath);

      expect(result.name).toBe('workflow');
      expect(existsSync(result.path)).toBe(true);
    });
  });
});
