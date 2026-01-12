import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addWorkflowCommand } from '../add.js';

// Mock telemetry to avoid external calls
vi.mock('../../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    eventAddWorkflow: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock stdin utilities
let mockReadFromStdin = vi.fn();
vi.mock('../../../utils/stdin.js', () => ({
  readFromStdin: () => mockReadFromStdin(),
}));

// Mock WorkflowStore
let mockWorkflowStore: any;
vi.mock('rover-core', async () => {
  const actual =
    await vi.importActual<typeof import('rover-core')>('rover-core');
  return {
    ...actual,
    WorkflowStore: vi.fn().mockImplementation(() => mockWorkflowStore),
    WorkflowStoreError: class extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'WorkflowStoreError';
      }
    },
  };
});

describe('add workflow command', () => {
  let testDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: any;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'rover-add-test-'));

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock process.exit to prevent tests from actually exiting
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as any);

    // Reset mocks
    mockWorkflowStore = {
      saveWorkflow: vi.fn(),
    };
    mockReadFromStdin = vi.fn().mockResolvedValue(null);
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('adding from local path', () => {
    it('should add a workflow from a local file', async () => {
      const workflowFile = join(testDir, 'test-workflow.yml');
      const workflowContent = `
version: '1.0'
name: test-workflow
description: Test workflow
inputs: []
outputs: []
steps: []
`;
      writeFileSync(workflowFile, workflowContent, 'utf8');

      mockWorkflowStore.saveWorkflow.mockResolvedValue({
        name: 'test-workflow',
        path: join(testDir, '.rover', 'workflows', 'test-workflow.yml'),
        isLocal: true,
      });

      await addWorkflowCommand(workflowFile, { json: false });

      expect(mockWorkflowStore.saveWorkflow).toHaveBeenCalledWith(
        workflowFile,
        undefined,
        undefined
      );
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('test-workflow');
      expect(output).toContain('local');
    });

    it('should add a workflow with custom name', async () => {
      const workflowFile = join(testDir, 'original.yml');
      const workflowContent = `
version: '1.0'
name: original
description: Test workflow
inputs: []
outputs: []
steps: []
`;
      writeFileSync(workflowFile, workflowContent, 'utf8');

      mockWorkflowStore.saveWorkflow.mockResolvedValue({
        name: 'custom-name',
        path: join(testDir, '.rover', 'workflows', 'custom-name.yml'),
        isLocal: true,
      });

      await addWorkflowCommand(workflowFile, {
        name: 'custom-name',
        json: false,
      });

      expect(mockWorkflowStore.saveWorkflow).toHaveBeenCalledWith(
        workflowFile,
        'custom-name',
        undefined
      );
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('custom-name');
    });

    it('should save to central store when not in project', async () => {
      const workflowFile = join(testDir, 'test.yml');
      const workflowContent = `
version: '1.0'
name: test
description: Test workflow
inputs: []
outputs: []
steps: []
`;
      writeFileSync(workflowFile, workflowContent, 'utf8');

      mockWorkflowStore.saveWorkflow.mockResolvedValue({
        name: 'test',
        path: join(tmpdir(), '.rover', 'config', 'workflows', 'test.yml'),
        isLocal: false,
      });

      await addWorkflowCommand(workflowFile, { json: false });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('test');
      expect(output).toContain('global');
    });
  });

  describe('adding from URL', () => {
    it('should add a workflow from a URL', async () => {
      const url = 'https://example.com/workflows/remote-workflow.yml';

      mockWorkflowStore.saveWorkflow.mockResolvedValue({
        name: 'remote-workflow',
        path: join(testDir, '.rover', 'workflows', 'remote-workflow.yml'),
        isLocal: true,
      });

      await addWorkflowCommand(url, { json: false });

      expect(mockWorkflowStore.saveWorkflow).toHaveBeenCalledWith(
        url,
        undefined,
        undefined
      );
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('remote-workflow');
    });

    it('should add a workflow from URL with custom name', async () => {
      const url = 'https://example.com/workflows/original.yml';

      mockWorkflowStore.saveWorkflow.mockResolvedValue({
        name: 'my-custom-workflow',
        path: join(testDir, '.rover', 'workflows', 'my-custom-workflow.yml'),
        isLocal: true,
      });

      await addWorkflowCommand(url, {
        name: 'my-custom-workflow',
        json: false,
      });

      expect(mockWorkflowStore.saveWorkflow).toHaveBeenCalledWith(
        url,
        'my-custom-workflow',
        undefined
      );
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('my-custom-workflow');
    });
  });

  describe('JSON output', () => {
    it('should output JSON with --json flag', async () => {
      const workflowFile = join(testDir, 'test.yml');
      const workflowContent = `
version: '1.0'
name: test
description: Test workflow
inputs: []
outputs: []
steps: []
`;
      writeFileSync(workflowFile, workflowContent, 'utf8');

      mockWorkflowStore.saveWorkflow.mockResolvedValue({
        name: 'test',
        path: join(testDir, '.rover', 'workflows', 'test.yml'),
        isLocal: true,
      });

      await addWorkflowCommand(workflowFile, { json: true });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0]?.[0];
      if (typeof output !== 'string') {
        throw new Error('Expected console.log output to be a string');
      }
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.workflow.name).toBe('test');
      expect(parsed.workflow.store).toBe('local');
      expect(parsed.workflow.path).toContain('test.yml');
    });

    it('should output JSON error with --json flag on failure', async () => {
      const { WorkflowStoreError } = await import('rover-core');
      mockWorkflowStore.saveWorkflow.mockRejectedValue(
        new WorkflowStoreError('Workflow already exists')
      );

      await addWorkflowCommand('test.yml', { json: true });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0]?.[0];
      if (typeof output !== 'string') {
        throw new Error('Expected console.log output to be a string');
      }
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(false);
      expect(parsed.errors).toContain('Workflow already exists');
    });
  });

  describe('error handling', () => {
    it('should handle WorkflowStoreError', async () => {
      const { WorkflowStoreError } = await import('rover-core');
      mockWorkflowStore.saveWorkflow.mockRejectedValue(
        new WorkflowStoreError('Workflow already exists in the store')
      );

      await addWorkflowCommand('test.yml', { json: false });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('Workflow already exists in the store');
    });

    it('should handle generic errors', async () => {
      mockWorkflowStore.saveWorkflow.mockRejectedValue(
        new Error('Unknown error')
      );

      await addWorkflowCommand('test.yml', { json: false });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('Failed to add workflow');
    });

    it('should handle network errors for URL sources', async () => {
      const { WorkflowStoreError } = await import('rover-core');
      mockWorkflowStore.saveWorkflow.mockRejectedValue(
        new WorkflowStoreError('Failed to fetch workflow from URL')
      );

      await addWorkflowCommand('https://example.com/missing.yml', {
        json: false,
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('Failed to fetch workflow from URL');
    });

    it('should handle file not found errors', async () => {
      const { WorkflowStoreError } = await import('rover-core');
      mockWorkflowStore.saveWorkflow.mockRejectedValue(
        new WorkflowStoreError(
          'Failed to read workflow from /path/to/missing.yml'
        )
      );

      await addWorkflowCommand('/path/to/missing.yml', { json: false });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('Failed to read workflow');
    });
  });

  describe('telemetry', () => {
    it('should track add workflow event', async () => {
      const workflowFile = join(testDir, 'test.yml');
      const workflowContent = `
version: '1.0'
name: test
description: Test workflow
inputs: []
outputs: []
steps: []
`;
      writeFileSync(workflowFile, workflowContent, 'utf8');

      mockWorkflowStore.saveWorkflow.mockResolvedValue({
        name: 'test',
        path: join(testDir, '.rover', 'workflows', 'test.yml'),
        isLocal: true,
      });

      const { getTelemetry } = await import('../../../lib/telemetry.js');
      const telemetry = getTelemetry();

      await addWorkflowCommand(workflowFile, { json: false });

      expect(telemetry!.eventAddWorkflow).toHaveBeenCalled();
      expect(telemetry!.shutdown).toHaveBeenCalled();
    });

    it('should shutdown telemetry even on error', async () => {
      const { WorkflowStoreError } = await import('rover-core');
      mockWorkflowStore.saveWorkflow.mockRejectedValue(
        new WorkflowStoreError('Error')
      );

      const { getTelemetry } = await import('../../../lib/telemetry.js');
      const telemetry = getTelemetry();

      await addWorkflowCommand('test.yml', { json: false });

      expect(telemetry!.shutdown).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle workflow names with special characters', async () => {
      mockWorkflowStore.saveWorkflow.mockResolvedValue({
        name: 'my-special_workflow@v2',
        path: join(
          testDir,
          '.rover',
          'workflows',
          'my-special_workflow@v2.yml'
        ),
        isLocal: true,
      });

      await addWorkflowCommand('source.yml', {
        name: 'my-special_workflow@v2',
        json: false,
      });

      expect(mockWorkflowStore.saveWorkflow).toHaveBeenCalledWith(
        'source.yml',
        'my-special_workflow@v2',
        undefined
      );
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should handle very long paths', async () => {
      const longPath =
        '/very/long/path/that/might/cause/issues/' + 'a'.repeat(100) + '.yml';

      mockWorkflowStore.saveWorkflow.mockResolvedValue({
        name: 'workflow',
        path: join(testDir, '.rover', 'workflows', 'workflow.yml'),
        isLocal: true,
      });

      await addWorkflowCommand(longPath, { json: false });

      expect(mockWorkflowStore.saveWorkflow).toHaveBeenCalledWith(
        longPath,
        undefined,
        undefined
      );
    });

    it('should handle empty custom name', async () => {
      mockWorkflowStore.saveWorkflow.mockResolvedValue({
        name: 'default-name',
        path: join(testDir, '.rover', 'workflows', 'default-name.yml'),
        isLocal: true,
      });

      await addWorkflowCommand('source.yml', { name: '', json: false });

      expect(mockWorkflowStore.saveWorkflow).toHaveBeenCalledWith(
        'source.yml',
        '',
        undefined
      );
    });
  });

  describe('stdin input', () => {
    it('should read workflow from stdin when source is "-"', async () => {
      const workflowContent = `
version: '1.0'
name: stdin-workflow
description: Workflow from stdin
inputs: []
outputs: []
steps: []
`;

      mockReadFromStdin.mockResolvedValue(workflowContent);
      mockWorkflowStore.saveWorkflow.mockResolvedValue({
        name: 'stdin-workflow',
        path: join(testDir, '.rover', 'workflows', 'stdin-workflow.yml'),
        isLocal: true,
      });

      await addWorkflowCommand('-', { json: false });

      expect(mockReadFromStdin).toHaveBeenCalled();
      expect(mockWorkflowStore.saveWorkflow).toHaveBeenCalled();

      // Check that a temporary file path was passed (not '-')
      const addCallArgs = mockWorkflowStore.saveWorkflow.mock.calls[0];
      expect(addCallArgs[0]).not.toBe('-');
      expect(addCallArgs[0]).toContain('rover-workflow-stdin-');
      expect(addCallArgs[1]).toBeUndefined();

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('stdin-workflow');
    });

    it('should read workflow from stdin with custom name', async () => {
      const workflowContent = `
version: '1.0'
name: original
description: Workflow from stdin
inputs: []
outputs: []
steps: []
`;

      mockReadFromStdin.mockResolvedValue(workflowContent);
      mockWorkflowStore.saveWorkflow.mockResolvedValue({
        name: 'custom-stdin',
        path: join(testDir, '.rover', 'workflows', 'custom-stdin.yml'),
        isLocal: true,
      });

      await addWorkflowCommand('-', { name: 'custom-stdin', json: false });

      expect(mockReadFromStdin).toHaveBeenCalled();
      expect(mockWorkflowStore.saveWorkflow).toHaveBeenCalled();

      // Check that custom name was passed
      const addCallArgs = mockWorkflowStore.saveWorkflow.mock.calls[0];
      expect(addCallArgs[1]).toBe('custom-stdin');

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('custom-stdin');
    });

    it('should handle empty stdin input', async () => {
      mockReadFromStdin.mockResolvedValue(null);

      await addWorkflowCommand('-', { json: false });

      expect(mockReadFromStdin).toHaveBeenCalled();
      expect(mockWorkflowStore.saveWorkflow).not.toHaveBeenCalled();

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('No input provided on stdin');
    });

    it('should output JSON when stdin is used with --json flag', async () => {
      const workflowContent = `
version: '1.0'
name: stdin-json
description: Workflow from stdin
inputs: []
outputs: []
steps: []
`;

      mockReadFromStdin.mockResolvedValue(workflowContent);
      mockWorkflowStore.saveWorkflow.mockResolvedValue({
        name: 'stdin-json',
        path: join(testDir, '.rover', 'workflows', 'stdin-json.yml'),
        isLocal: true,
      });

      await addWorkflowCommand('-', { json: true });

      expect(mockReadFromStdin).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();

      const output = consoleLogSpy.mock.calls[0]?.[0];
      if (typeof output !== 'string') {
        throw new Error('Expected console.log output to be a string');
      }
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.workflow.name).toBe('stdin-json');
    });

    it('should handle errors when reading from stdin', async () => {
      const workflowContent = 'invalid workflow content';

      mockReadFromStdin.mockResolvedValue(workflowContent);

      const { WorkflowStoreError } = await import('rover-core');
      mockWorkflowStore.saveWorkflow.mockRejectedValue(
        new WorkflowStoreError('Invalid workflow format')
      );

      await addWorkflowCommand('-', { json: false });

      expect(mockReadFromStdin).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('Invalid workflow format');
    });
  });
});
