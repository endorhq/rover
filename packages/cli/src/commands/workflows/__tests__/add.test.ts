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

// Mock WorkflowStoreManager
let mockWorkflowStoreManager: any;
vi.mock('rover-core', async () => {
  const actual =
    await vi.importActual<typeof import('rover-core')>('rover-core');
  return {
    ...actual,
    WorkflowStoreManager: vi
      .fn()
      .mockImplementation(() => mockWorkflowStoreManager),
    WorkflowStoreManagerError: class extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'WorkflowStoreManagerError';
      }
    },
  };
});

describe('add workflow command', () => {
  let testDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'rover-add-test-'));

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Reset mock
    mockWorkflowStoreManager = {
      add: vi.fn(),
    };
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
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

      mockWorkflowStoreManager.add.mockResolvedValue({
        name: 'test-workflow',
        path: join(testDir, '.rover', 'workflows', 'test-workflow.yml'),
        isLocal: true,
      });

      await addWorkflowCommand(workflowFile, { json: false });

      expect(mockWorkflowStoreManager.add).toHaveBeenCalledWith(
        workflowFile,
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

      mockWorkflowStoreManager.add.mockResolvedValue({
        name: 'custom-name',
        path: join(testDir, '.rover', 'workflows', 'custom-name.yml'),
        isLocal: true,
      });

      await addWorkflowCommand(workflowFile, {
        name: 'custom-name',
        json: false,
      });

      expect(mockWorkflowStoreManager.add).toHaveBeenCalledWith(
        workflowFile,
        'custom-name'
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

      mockWorkflowStoreManager.add.mockResolvedValue({
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
      expect(output).toContain('central');
    });
  });

  describe('adding from URL', () => {
    it('should add a workflow from a URL', async () => {
      const url = 'https://example.com/workflows/remote-workflow.yml';

      mockWorkflowStoreManager.add.mockResolvedValue({
        name: 'remote-workflow',
        path: join(testDir, '.rover', 'workflows', 'remote-workflow.yml'),
        isLocal: true,
      });

      await addWorkflowCommand(url, { json: false });

      expect(mockWorkflowStoreManager.add).toHaveBeenCalledWith(url, undefined);
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('remote-workflow');
    });

    it('should add a workflow from URL with custom name', async () => {
      const url = 'https://example.com/workflows/original.yml';

      mockWorkflowStoreManager.add.mockResolvedValue({
        name: 'my-custom-workflow',
        path: join(testDir, '.rover', 'workflows', 'my-custom-workflow.yml'),
        isLocal: true,
      });

      await addWorkflowCommand(url, {
        name: 'my-custom-workflow',
        json: false,
      });

      expect(mockWorkflowStoreManager.add).toHaveBeenCalledWith(
        url,
        'my-custom-workflow'
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

      mockWorkflowStoreManager.add.mockResolvedValue({
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
      const { WorkflowStoreManagerError } = await import('rover-core');
      mockWorkflowStoreManager.add.mockRejectedValue(
        new WorkflowStoreManagerError('Workflow already exists')
      );

      await addWorkflowCommand('test.yml', { json: true });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0]?.[0];
      if (typeof output !== 'string') {
        throw new Error('Expected console.log output to be a string');
      }
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('Workflow already exists');
    });
  });

  describe('error handling', () => {
    it('should handle WorkflowStoreManagerError', async () => {
      const { WorkflowStoreManagerError } = await import('rover-core');
      mockWorkflowStoreManager.add.mockRejectedValue(
        new WorkflowStoreManagerError('Workflow already exists in the store')
      );

      await addWorkflowCommand('test.yml', { json: false });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('Workflow already exists in the store');
    });

    it('should handle generic errors', async () => {
      mockWorkflowStoreManager.add.mockRejectedValue(
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
      const { WorkflowStoreManagerError } = await import('rover-core');
      mockWorkflowStoreManager.add.mockRejectedValue(
        new WorkflowStoreManagerError('Failed to fetch workflow from URL')
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
      const { WorkflowStoreManagerError } = await import('rover-core');
      mockWorkflowStoreManager.add.mockRejectedValue(
        new WorkflowStoreManagerError(
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

      mockWorkflowStoreManager.add.mockResolvedValue({
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
      const { WorkflowStoreManagerError } = await import('rover-core');
      mockWorkflowStoreManager.add.mockRejectedValue(
        new WorkflowStoreManagerError('Error')
      );

      const { getTelemetry } = await import('../../../lib/telemetry.js');
      const telemetry = getTelemetry();

      await addWorkflowCommand('test.yml', { json: false });

      expect(telemetry!.shutdown).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle workflow names with special characters', async () => {
      mockWorkflowStoreManager.add.mockResolvedValue({
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

      expect(mockWorkflowStoreManager.add).toHaveBeenCalledWith(
        'source.yml',
        'my-special_workflow@v2'
      );
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should handle very long paths', async () => {
      const longPath =
        '/very/long/path/that/might/cause/issues/' + 'a'.repeat(100) + '.yml';

      mockWorkflowStoreManager.add.mockResolvedValue({
        name: 'workflow',
        path: join(testDir, '.rover', 'workflows', 'workflow.yml'),
        isLocal: true,
      });

      await addWorkflowCommand(longPath, { json: false });

      expect(mockWorkflowStoreManager.add).toHaveBeenCalledWith(
        longPath,
        undefined
      );
    });

    it('should handle empty custom name', async () => {
      mockWorkflowStoreManager.add.mockResolvedValue({
        name: 'default-name',
        path: join(testDir, '.rover', 'workflows', 'default-name.yml'),
        isLocal: true,
      });

      await addWorkflowCommand('source.yml', { name: '', json: false });

      expect(mockWorkflowStoreManager.add).toHaveBeenCalledWith(
        'source.yml',
        ''
      );
    });
  });
});
