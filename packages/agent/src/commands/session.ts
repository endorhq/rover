import colors from 'ansi-colors';
import { getVersion, launch, ProcessManager, VERBOSE } from 'rover-core';
import { createAgent } from '../lib/agents/index.js';
import { existsSync } from 'node:fs';
import { showRoverHeader } from 'rover-core/src/display/header.js';

interface SessionCommandOptions {
  // Path to the context directory
  contextDir?: string;
}

/**
 * The session command allows users to run an agent in interactive mode.
 * Users can provide a context directory to the agent to provide context.
 */
export const sessionCommand = async (
  agent: string,
  initialPrompt?: string,
  options: SessionCommandOptions = {}
) => {
  const version = getVersion();
  showRoverHeader({
    version,
    agent,
    defaultAgent: false,
    projectName: 'Workspace',
    projectPath: '/workspace',
  });

  const processManager = new ProcessManager({
    title: 'Start interactive session',
  });
  processManager?.start();

  const agentInstance = createAgent(agent);

  // Build context instructions from context directory
  let preContextInstructions = '';

  if (options.contextDir && existsSync(options.contextDir)) {
    const indexPath = `${options.contextDir}/index.md`;

    if (existsSync(indexPath)) {
      processManager.addItem('Load context information for this session');

      if (VERBOSE) {
        console.log(
          colors.gray(
            `\nLoading context from directory: ${colors.cyan(options.contextDir)}`
          )
        );
      }

      preContextInstructions = `You are helping the user iterate over the existing changes in this project. There are already changes in the project, so it's critical you get familiar with the current changes before continuing. Do not use git, as it's not available. Instead, read the context index file at \`${indexPath}\` for a complete overview of all available context sources. The context directory at \`${options.contextDir}/\` contains all the reference materials.

After reading the context index (it's mandatory), ask the user for the new changes and follow the new instructions you get rigorously.`;

      processManager.completeLastItem();
    }
  }

  processManager.addItem('Starting agent');
  processManager.completeLastItem();
  processManager.finish();

  await launch(
    agentInstance.binary,
    agentInstance.toolInteractiveArguments(
      preContextInstructions,
      initialPrompt
    ),
    {
      reject: false,
      stdio: 'inherit', // This gives full control to the user
    }
  );

  console.log(colors.green('\n✓ Session ended successfully'));
};
