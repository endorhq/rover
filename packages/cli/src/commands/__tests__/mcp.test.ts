import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mcpCommand } from '../mcp.js';
import { createMCPServer } from '../../lib/mcp/server.js';

// Mock the MCP server
vi.mock('../../lib/mcp/server.js', () => ({
  createMCPServer: vi.fn(),
}));

// Mock process streams
const mockStdout = {
  write: vi.fn(),
};
const mockStdin = {
  on: vi.fn(),
};

const mockServer = {
  connect: vi.fn(),
  close: vi.fn(),
};

describe('mcp command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createMCPServer).mockReturnValue(mockServer as any);

    // Mock console.error to capture startup messages
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock process exit
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should start MCP server successfully', async () => {
    mockServer.connect.mockResolvedValue(undefined);

    await expect(mcpCommand({ json: false })).resolves.not.toThrow();

    expect(createMCPServer).toHaveBeenCalledOnce();
    expect(mockServer.connect).toHaveBeenCalledWith(process.stdin, process.stdout);
    expect(console.error).toHaveBeenCalledWith('Starting Rover MCP server...');
    expect(console.error).toHaveBeenCalledWith('MCP server started successfully');
  });

  it('should handle server connection errors', async () => {
    const error = new Error('Connection failed');
    mockServer.connect.mockRejectedValue(error);

    await expect(mcpCommand({ json: false })).rejects.toThrow('process.exit called');

    expect(createMCPServer).toHaveBeenCalledOnce();
    expect(mockServer.connect).toHaveBeenCalledWith(process.stdin, process.stdout);
  });

  it('should work in JSON mode', async () => {
    mockServer.connect.mockResolvedValue(undefined);

    await expect(mcpCommand({ json: true })).resolves.not.toThrow();

    expect(createMCPServer).toHaveBeenCalledOnce();
    expect(mockServer.connect).toHaveBeenCalledWith(process.stdin, process.stdout);
  });

  it('should handle server creation errors', async () => {
    const error = new Error('Server creation failed');
    vi.mocked(createMCPServer).mockImplementation(() => {
      throw error;
    });

    await expect(mcpCommand({ json: false })).rejects.toThrow('process.exit called');

    expect(createMCPServer).toHaveBeenCalledOnce();
  });
});