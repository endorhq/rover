// Set the different subcommands for the config command.
// These commands changes the configuration for the different agents.

import { Argument, Command } from 'commander';
import { DEFAULT_MCP_TRANSPORT, mcpInstallCommand } from './mcp.js';

// Simple helper to collect multiple options using the same key
const collect = (value: string, previous: string[]) => {
  return previous.concat([value]);
};

export const addConfigCommands = (program: Command) => {
  // Add the different commands
  const config = program
    .command('config')
    .description('Configure Agent capabilities');

  config
    .command('mcp')
    .description('Configure an MCP server globally for a given agent')
    .addArgument(
      new Argument(
        '<agent>',
        'AI Coding Agent to add the MCP server to'
      ).choices(['claude', 'codex', 'gemini', 'qwen'])
    )
    .argument('<name>', 'The name of the MCP server')
    .argument('<commandOrUrl>', 'The command or URL to run this MCP server')
    .option(
      '-t, --transport <transport>',
      'The transport type (sse, stdio, http)',
      DEFAULT_MCP_TRANSPORT
    )
    .option(
      '-e, --env <env>',
      'Set an environment variable for the MCP server using KEY=VALUE format',
      collect,
      []
    )
    .option(
      '-H, --header <header>',
      'Set HTTP headers for SSE and HTTP transports',
      collect,
      []
    )
    .action(mcpInstallCommand);
};
