import { Command } from 'commander';
import { exitWithError } from '../utils/exit.js';
import { createMCPServer } from '../lib/mcp/server.js';

export async function mcpCommand(options: { json?: boolean }) {
  try {
    console.error('Starting Rover MCP server...');
    const server = createMCPServer();

    // Connect server to stdio transport
    await server.connect(process.stdin, process.stdout);

    console.error('MCP server started successfully');

    // Keep the process running
    return new Promise(() => {
      // Server will handle all communication through stdio
    });
  } catch (error) {
    exitWithError(
      {
        error: `Failed to start MCP server: ${error instanceof Error ? error.message : String(error)}`,
        success: false,
      },
      options.json === true,
      {
        tips: [
          'Ensure the MCP client is properly configured',
          'Check that all required dependencies are installed',
        ],
      }
    );
  }
}