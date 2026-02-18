import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectWorkflowCommand } from '../inspect.js';

// Mock telemetry to avoid external calls
vi.mock('../../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    eventInspectWorkflow: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock workflow store
vi.mock('../../../lib/workflow.js', () => ({
  initWorkflowStore: vi.fn().mockReturnValue({
    getWorkflowEntry: vi.fn((name: string) => {
      if (name === 'swe') {
        return {
          workflow: {
            name: 'swe',
            description: 'Software engineering workflow',
            version: '1.0.0',
            inputs: [
              {
                name: 'task',
                description: 'Task to complete',
                required: true,
              },
            ],
            outputs: [
              {
                name: 'result',
                description: 'Task result',
              },
            ],
            steps: [
              {
                name: 'analyze',
                outputs: [{ name: 'analysis' }],
              },
              {
                name: 'implement',
                outputs: [{ name: 'code' }],
              },
            ],
            defaults: {
              tool: 'claude',
              model: 'claude-3-sonnet',
            },
            config: {
              timeout: 300,
              continueOnError: false,
            },
            filePath: '/builtin/swe.yml',
            toObject: vi.fn().mockReturnValue({
              name: 'swe',
              description: 'Software engineering workflow',
              version: '1.0.0',
            }),
          },
          source: 'built-in',
        };
      }
      return undefined;
    }),
  }),
}));

// Mock stdin utilities
let mockReadFromStdin = vi.fn();
vi.mock('../../../utils/stdin.js', () => ({
  readFromStdin: () => mockReadFromStdin(),
}));

// Mock global fetch for HTTP tests
global.fetch = vi.fn();

describe('inspect workflow command', () => {
  let testDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'rover-inspect-test-'));

    // Spy on console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Reset stdin mock
    mockReadFromStdin = vi.fn().mockResolvedValue(null);
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });

    // Clear all mocks
    vi.clearAllMocks();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('workflow name lookup', () => {
    it('should load built-in workflow by name', async () => {
      await inspectWorkflowCommand('swe', { json: false, raw: false });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('Workflow Details');
      expect(output).toContain('swe');
      expect(output).toContain('Software engineering workflow');
    });

    it('should handle non-existent workflow name', async () => {
      await inspectWorkflowCommand('nonexistent', { json: false, raw: false });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('Workflow "nonexistent" not found');
    });

    it('should output JSON for workflow name with --json flag', async () => {
      await inspectWorkflowCommand('swe', { json: true, raw: false });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0]?.[0];
      if (typeof output !== 'string') {
        throw new Error('Expected console.log output to be a string');
      }
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.workflow.name).toBe('swe');
      expect(parsed.source).toBe('built-in');
    });
  });

  describe('local file loading', () => {
    it('should load workflow from local file path', async () => {
      const workflowFile = join(testDir, 'test-workflow.yml');
      const workflowContent = `name: test-workflow
description: Test workflow
version: 1.0.0
inputs:
  - name: input1
    description: Test input
    type: string
    required: true
outputs:
  - name: output1
    description: Test output
    type: string
steps:
  - id: step1
    name: step1
    type: agent
    prompt: Test step
`;
      writeFileSync(workflowFile, workflowContent);

      await inspectWorkflowCommand(workflowFile, { json: false, raw: false });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('Workflow Details');
      expect(output).toContain('test-workflow');
    });

    it('should handle missing file path', async () => {
      const missingFile = join(testDir, 'missing.yml');

      await inspectWorkflowCommand(missingFile, { json: false, raw: false });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain(`File not found: ${missingFile}`);
    });

    it('should output raw YAML with --raw flag', async () => {
      const workflowFile = join(testDir, 'test-workflow.yml');
      const workflowContent = `name: test-workflow
description: Test workflow
version: 1.0.0
steps:
  - id: step1
    name: step1
    type: agent
    prompt: Test step
`;
      writeFileSync(workflowFile, workflowContent);

      await inspectWorkflowCommand(workflowFile, { json: false, raw: true });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0]?.[0];
      if (typeof output !== 'string') {
        throw new Error('Expected console.log output to be a string');
      }
      expect(output).toContain('name: test-workflow');
      expect(output).toContain('description: Test workflow');
    });
  });

  describe('HTTP URL fetching', () => {
    beforeEach(() => {
      // Reset fetch mock before each test
      (global.fetch as ReturnType<typeof vi.fn>).mockReset();
    });

    it('should fetch and load workflow from HTTP URL', async () => {
      const workflowContent = `name: remote-workflow
description: Remote workflow
version: 1.0.0
steps:
  - id: step1
    name: step1
    type: agent
    prompt: Remote step
`;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-length': '100' }),
        text: async () => workflowContent,
      });

      await inspectWorkflowCommand('https://example.com/workflow.yml', {
        json: false,
        raw: false,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/workflow.yml',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('Workflow Details');
      expect(output).toContain('remote-workflow');
    });

    it('should handle network errors when fetching from URL', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      await inspectWorkflowCommand('https://example.com/workflow.yml', {
        json: false,
        raw: false,
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('Failed to fetch workflow from URL');
      expect(output).toContain('Network error');
    });

    it('should handle HTTP error responses', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await inspectWorkflowCommand('https://example.com/workflow.yml', {
        json: false,
        raw: false,
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('HTTP 404: Not Found');
    });

    it('should reject files that are too large', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'content-length': (11 * 1024 * 1024).toString(),
        }), // 11MB
      });

      await inspectWorkflowCommand('https://example.com/workflow.yml', {
        json: false,
        raw: false,
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('Workflow file too large');
    });

    it('should handle timeout errors', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(() => {
        return new Promise((_, reject) => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          setTimeout(() => reject(error), 100);
        });
      });

      await inspectWorkflowCommand('https://example.com/workflow.yml', {
        json: false,
        raw: false,
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('Request timeout');
    });

    it('should reject invalid URL formats', async () => {
      await inspectWorkflowCommand('not-a-valid-url', {
        json: false,
        raw: false,
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('Workflow "not-a-valid-url" not found');
    });

    it('should handle empty response from URL', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-length': '0' }),
        text: async () => '',
      });

      await inspectWorkflowCommand('https://example.com/workflow.yml', {
        json: false,
        raw: false,
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('Empty response from URL');
    });
  });

  describe('source type detection', () => {
    it('should detect HTTP URLs correctly', async () => {
      const workflowContent = `name: http-workflow
description: HTTP workflow
version: 1.0.0
steps:
  - id: step1
    name: step1
    type: agent
    prompt: Test
`;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-length': '100' }),
        text: async () => workflowContent,
      });

      await inspectWorkflowCommand('http://example.com/workflow.yml', {
        json: true,
        raw: false,
      });

      const output = consoleLogSpy.mock.calls[0]?.[0];
      if (typeof output !== 'string') {
        throw new Error('Expected console.log output to be a string');
      }
      const parsed = JSON.parse(output);
      expect(parsed.source).toBe('http://example.com/workflow.yml');
    });

    it('should detect file paths with slashes', async () => {
      const workflowFile = join(testDir, 'test.yml');
      const workflowContent = `name: file-workflow
description: File workflow
version: 1.0.0
steps:
  - id: step1
    name: step1
    type: agent
    prompt: Test
`;
      writeFileSync(workflowFile, workflowContent);

      await inspectWorkflowCommand(workflowFile, { json: true, raw: false });

      const output = consoleLogSpy.mock.calls[0]?.[0];
      if (typeof output !== 'string') {
        throw new Error('Expected console.log output to be a string');
      }
      const parsed = JSON.parse(output);
      expect(parsed.source).toBe(workflowFile);
    });

    it('should detect file paths with .yml extension', async () => {
      const workflowFile = join(testDir, 'workflow.yml');
      const workflowContent = `name: yml-workflow
description: YML workflow
version: 1.0.0
steps:
  - id: step1
    name: step1
    type: agent
    prompt: Test
`;
      writeFileSync(workflowFile, workflowContent);

      await inspectWorkflowCommand(workflowFile, { json: true, raw: false });

      const output = consoleLogSpy.mock.calls[0]?.[0];
      if (typeof output !== 'string') {
        throw new Error('Expected console.log output to be a string');
      }
      const parsed = JSON.parse(output);
      expect(parsed.source).toBe(workflowFile);
    });
  });

  describe('stdin input', () => {
    it('should read workflow from stdin when source is "-"', async () => {
      const workflowContent = `name: stdin-workflow
description: Workflow from stdin
version: 1.0.0
inputs:
  - name: task
    description: Task to complete
    type: string
    required: true
outputs:
  - name: result
    description: Task result
    type: string
steps:
  - id: step1
    name: analyze
    type: agent
    prompt: Analyze the task
`;

      mockReadFromStdin.mockResolvedValue(workflowContent);

      await inspectWorkflowCommand('-', { json: false, raw: false });

      expect(mockReadFromStdin).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('Workflow Details');
      expect(output).toContain('stdin-workflow');
      expect(output).toContain('Workflow from stdin');
    });

    it('should output JSON when stdin is used with --json flag', async () => {
      const workflowContent = `name: stdin-json
description: JSON workflow from stdin
version: 1.0.0
steps:
  - id: step1
    name: step1
    type: agent
    prompt: Test
`;

      mockReadFromStdin.mockResolvedValue(workflowContent);

      await inspectWorkflowCommand('-', { json: true, raw: false });

      expect(mockReadFromStdin).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();

      const output = consoleLogSpy.mock.calls[0]?.[0];
      if (typeof output !== 'string') {
        throw new Error('Expected console.log output to be a string');
      }
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(true);
      expect(parsed.workflow.name).toBe('stdin-json');
      expect(parsed.source).toBe('stdin');
    });

    it('should output raw YAML when stdin is used with --raw flag', async () => {
      const workflowContent = `name: stdin-raw
description: Raw workflow from stdin
version: 1.0.0
steps:
  - id: step1
    name: step1
    type: agent
    prompt: Test
`;

      mockReadFromStdin.mockResolvedValue(workflowContent);

      await inspectWorkflowCommand('-', { json: false, raw: true });

      expect(mockReadFromStdin).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();

      const output = consoleLogSpy.mock.calls[0]?.[0];
      if (typeof output !== 'string') {
        throw new Error('Expected console.log output to be a string');
      }
      expect(output).toContain('name: stdin-raw');
      expect(output).toContain('description: Raw workflow from stdin');
    });

    it('should handle empty stdin input', async () => {
      mockReadFromStdin.mockResolvedValue(null);

      await inspectWorkflowCommand('-', { json: false, raw: false });

      expect(mockReadFromStdin).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('No input provided on stdin');
    });

    it('should handle empty stdin input with --json flag', async () => {
      mockReadFromStdin.mockResolvedValue(null);

      await inspectWorkflowCommand('-', { json: true, raw: false });

      expect(mockReadFromStdin).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();

      const output = consoleLogSpy.mock.calls[0]?.[0];
      if (typeof output !== 'string') {
        throw new Error('Expected console.log output to be a string');
      }
      const parsed = JSON.parse(output);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBe('No input provided on stdin');
    });

    it('should handle empty stdin input with --raw flag', async () => {
      mockReadFromStdin.mockResolvedValue(null);

      await inspectWorkflowCommand('-', { json: false, raw: true });

      expect(mockReadFromStdin).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      const output = consoleErrorSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      expect(output).toContain('No input provided on stdin');
    });

    it('should handle invalid workflow content from stdin', async () => {
      const invalidContent = 'invalid yaml content: [[[';

      mockReadFromStdin.mockResolvedValue(invalidContent);

      await inspectWorkflowCommand('-', { json: false, raw: false });

      expect(mockReadFromStdin).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls
        .map(call => call.join(' '))
        .join('\n');
      // Should show an error about the workflow being invalid
      expect(output).toContain('Failed to load workflow');
    });
  });
});
