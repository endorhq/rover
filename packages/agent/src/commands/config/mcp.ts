import colors from 'ansi-colors';
import { CommandOutput } from '../../cli.js';
import { createAgent } from '../../lib/agents/index.js';
import ora from 'ora';

export const DEFAULT_MCP_TRANSPORT = 'stdio';

interface ConfigMCPCommandOptions {
  // MCP transport protocol
  transport: string;
  // Environment variables
  env: string[];
  // HTTP Headers for SSE and HTTP
  header: string[];
}

interface ConfigMCPCommandOutput extends CommandOutput {}

/**
 * Install an AI Coding Tool and configure the required credentials to run it
 */
export const mcpInstallCommand = async (
  agentName: string,
  mcpName: string,
  commandOrUrl: string,
  options: ConfigMCPCommandOptions
) => {
  const output: ConfigMCPCommandOutput = {
    success: false,
  };

  const spinner = ora({
    text: `Installing MCP server`,
    spinner: 'dots2',
  });

  try {
    console.log(colors.bold('MCP Server to install'));
    console.log(colors.gray('├── Agent: ') + agentName);
    console.log(colors.gray('├── MCP Name: ') + colors.cyan(mcpName));
    console.log(
      colors.gray('├── MCP Command or URL: ') + colors.cyan(commandOrUrl)
    );
    console.log(colors.gray('└── MCP Transport: ') + options.transport);

    console.log();
    spinner.text = `Checking agent`;
    spinner.start();

    const agent = createAgent(agentName);
    const installed = await agent.isInstalled();

    if (!installed) {
      output.error = `The ${agent.name} is not installed in the system. Install it first`;
    } else {
      spinner.text = `Installing MCP server in ${agent.name}`;

      // We can install the MCP server
      // These methods can throw errors
      await agent.configureMCP(
        mcpName,
        commandOrUrl,
        options.transport,
        options.env,
        options.header
      );

      spinner.succeed('Installation completed successfully');
      output.success = true;
    }
  } catch (err) {
    spinner.fail('The MCP server was not installed');
    output.success = false;
    output.error = err instanceof Error ? err.message : `${err}`;
  }

  if (!output.success) {
    console.log(colors.red(`\n✗ ${output.error}`));
  }
};
