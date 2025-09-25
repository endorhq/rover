import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { roverTools, handleToolCall } from './tools.js';

function registerRoverTool(
  server: McpServer,
  toolName: string,
  description: string,
  inputSchema: any
) {
  server.registerTool(
    toolName,
    {
      title: toolName,
      description,
      inputSchema: {},
    },
    async (args: any) => {
      try {
        const originalLog = console.log;
        console.log = console.error;
        const result = await handleToolCall(toolName, {});
        console.log = originalLog;
        console.error('result of tool call is', result);
        return {
          content: [
            {
              type: 'text' as const,
              text:
                typeof result === 'string'
                  ? result
                  : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

export function createMCPServer(): {
  server: McpServer;
  transport: StdioServerTransport;
} {
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
    registerRoverTool(
      server,
      tool.name,
      tool.description ?? '',
      tool.inputSchema
    );
  }

  // Error handling will be done at the transport level

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  return { server, transport };
}
