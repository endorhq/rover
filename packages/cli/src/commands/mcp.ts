import { Command } from 'commander';
import { exitWithError } from '../utils/exit.js';
import { createMCPServer } from '../lib/mcp/server.js';

export const mcpCommand = async (): Promise<void> => {
  try {
    console.error('Starting Rover MCP server...');
    const { server, transport } = createMCPServer();

    // Connect server to stdio transport
    await server.connect(transport);

    console.error('MCP server started successfully');

    // Keep the process running
    await new Promise<void>(() => {
      // Server will handle all communication through stdio
    });
  } catch (error) {
    exitWithError(
      {
        error: `Failed to start MCP server: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      },
      false,
      {
        tips: [
          'Ensure the MCP client is properly configured',
          'Check that all required dependencies are installed',
        ],
      }
    );
  }
}
