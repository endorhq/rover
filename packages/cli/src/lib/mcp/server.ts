import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { roverTools, handleToolCall } from './tools.js';

function registerRoverTool(server: McpServer, toolName: string, description: string, inputSchema: any) {
  server.registerTool(toolName, {
    title: toolName,
    description: description,
    inputSchema: inputSchema,
  }, async (args) => {
    try {
      const result = await handleToolCall(toolName, args);
      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });
}

export function createMCPServer(): { server: McpServer; transport: StdioServerTransport } {
  const server = new McpServer(
    {
      name: 'rover',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const transport = new StdioServerTransport();

  // Register all rover tools
  for (const tool of roverTools) {
    registerRoverTool(server, tool.name, tool.description, tool.inputSchema);
  }

  // Error handling
  server.onerror = (error) => {
    console.error('[MCP Error]', error);
  };

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  return { server, transport };
}
