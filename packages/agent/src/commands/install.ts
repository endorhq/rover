import colors from 'ansi-colors';
import { CommandOutput } from '../cli.js';
import { createAgent } from '../lib/agents/index.js';

interface InstallCommandOptions {
  // Specific version to install
  version: string;
  // User directory
  userDir: string;
}

interface InstallCommandOutput extends CommandOutput {}

// Default agent version to install
export const DEFAULT_INSTALL_VERSION = 'latest';
export const DEFAULT_INSTALL_DIRECTORY = '/home/agent';

/**
 * Install an AI Coding Tool and configure the required credentials to run it
 */
export const installCommand = async (
  agentName: string,
  options: InstallCommandOptions = {
    version: DEFAULT_INSTALL_VERSION,
    userDir: DEFAULT_INSTALL_DIRECTORY,
  }
) => {
  const output: InstallCommandOutput = {
    success: false,
  };

  try {
    console.log(colors.bold('Agent Installation'));
    console.log(colors.gray('├── Agent: ') + colors.cyan(agentName));
    console.log(colors.gray('└── Version: ') + colors.cyan(options.version));

    // Create agent instance
    const agent = createAgent(agentName, options.version);

    console.log(colors.bold('\nValidating Credentials'));

    // Validate agent credentials
    const validation = agent.validateCredentials();

    if (!validation.valid) {
      console.log(colors.red('\n✗ Credential validation failed'));
      validation.missing.forEach((missing, idx) => {
        const prefix = idx === validation.missing.length - 1 ? '└──' : '├──';
        console.log(colors.red(`${prefix} Missing: ${missing}`));
      });

      console.log(
        colors.yellow(
          '\n💡 Please ensure all required credential files are present before running the install command.'
        )
      );

      output.success = false;
      output.error = 'Credential validation failed';
    } else {
      console.log(colors.green('✓ All required credential files found'));

      // Install the agent
      await agent.install();

      // Copy credentials to home directory (for container usage)
      await agent.copyCredentials(options.userDir);

      console.log(colors.green('\n✓ Installation completed successfully'));
      output.success = true;
    }
  } catch (err) {
    output.success = false;
    output.error = err instanceof Error ? err.message : `${err}`;
  }

  if (!output.success) {
    console.log(colors.red(`\n✗ ${output.error}`));
  }
};
