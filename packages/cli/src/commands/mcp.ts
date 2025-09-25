import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { listCommand } from '../commands/list.js';
import { z } from 'zod';

/**
 * Start an MCP server
 */
export const mcpCommand = async (
  taskId: string,
  options: {
    json?: boolean;
    removeAll?: boolean;
    removeContainer?: boolean;
    removeGitWorktreeAndBranch?: boolean;
  } = {}
) => {
  const server = new McpServer({
    name: 'rover',
    version: '1.0.0',
  });

  const runCommand = async (
    command: (...args: any[]) => void,
    args: any = {}
  ) => {
    const oldConsoleLog = console.log;
    let commandOutput = '';
    console.log = function (...args) {
      commandOutput +=
        args
          .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
          .join(' ') + '\n';
    };
    await command({ ...args, json: true });
    console.log = oldConsoleLog;
    return {
      content: [
        {
          type: 'text' as const,
          text: commandOutput,
        },
      ],
    };
  };

  server.registerTool(
    'list-tasks',
    {
      title: 'List tasks',
      description: 'List Rover tasks in the current project',
      inputSchema: {},
    },
    async () => {
      return runCommand(listCommand);
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
};
