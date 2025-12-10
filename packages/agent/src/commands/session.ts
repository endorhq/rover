import { IterationStatusManager, PreContextDataManager } from 'rover-schemas';
import colors from 'ansi-colors';
import { CommandOutput } from '../cli.js';
import {
  getVersion,
  launch,
  ProcessManager,
  showRegularHeader,
  VERBOSE,
} from 'rover-core';
import { createAgent } from '../lib/agents/index.js';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { basename } from 'node:path';
import { V } from 'vitest/dist/chunks/reporters.nr4dxCkA.js';

interface SessionCommandOptions {
  // Paths to pre-context JSON files
  preContextFile: string[];
}

/**
 * The session command allows users to run an agent in interactive mode.
 * Users can provide a pre-context file to the agent to provide context.
 */
export const sessionCommand = async (
  agent: string,
  initialPrompt?: string,
  options: SessionCommandOptions = { preContextFile: [] }
) => {
  const version = getVersion();
  showRegularHeader(version, '/workspace', 'Rover Agent');

  const processManager = new ProcessManager({
    title: 'Start interactive session',
  });
  processManager?.start();

  const preContextFiles: string[] = options.preContextFile || [];
  const agentInstance = createAgent(agent);

  // Load and validate pre-context files
  if (options.preContextFile && options.preContextFile.length > 0) {
    processManager.addItem('Load context information for this session');
    let successContext = true;

    if (VERBOSE) {
      console.log(
        colors.gray(
          `\nLoading pre-context files for this session: ${colors.cyan(
            options.preContextFile.join(', ')
          )}`
        )
      );
    }

    options.preContextFile.forEach(preContextFilePath => {
      if (!existsSync(preContextFilePath)) {
        successContext = false;

        if (VERBOSE) {
          console.warn(
            `\n⚠ Pre-context file not found at ${preContextFilePath}. Skipping this file.`
          );
        }
      } else {
        try {
          if (VERBOSE) {
            console.log(
              colors.gray(
                `\nLoading pre-context file: ${colors.cyan(preContextFilePath)}`
              )
            );
          }
          // Load and validate pre-context data using PreContextDataManager
          const rawData = readFileSync(preContextFilePath, 'utf-8');
          const parsedData = JSON.parse(rawData);
          // Validate by creating a PreContextDataManager instance
          new PreContextDataManager(parsedData, preContextFilePath);

          // Track the file path for later use
          preContextFiles.push(preContextFilePath);

          if (VERBOSE) {
            console.log(
              colors.gray(
                `\nLoaded pre-context file: ${colors.cyan(preContextFilePath)}`
              )
            );
          }
        } catch (err) {
          successContext = false;

          if (VERBOSE) {
            console.warn(
              `\n⚠ Failed to load pre-context file ${preContextFilePath}: ${err instanceof Error ? err.message : String(err)}. Skipping this file.`
            );
          }
        }
      }
    });

    if (successContext) {
      processManager.completeLastItem();
    } else {
      processManager.failLastItem(
        'There were errors reading the context files. Skipping them'
      );
    }
  }

  processManager.addItem('Creating temporary context folder');

  // To ensure all agents can read it, we will move the pre context files to the workspace:
  const targetDir = '/workspace/.rover-context';
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
  let projectContextPaths = ``;

  processManager.completeLastItem();
  processManager.addItem('Starting agent');

  preContextFiles.forEach(el => {
    const targetPath = `${targetDir}/${basename(el)}`;
    copyFileSync(el, targetPath);
    projectContextPaths = `${projectContextPaths}
  - ${targetPath}`;
  });

  const preContextInstructions = `You are helping the user iterate over the existing changes in this project. There are already changes in the project, so it's critical you get familiar with the current changes before continuing. Do not use git, as it's not available. Instead, read the following files for context. Just read them, do not apply any new change until the user asks explicitly. The context files are: 
  ${projectContextPaths}
  
  After reading the context files (it's mandatory), ask the user for the new changes and follow the new instructions you get rigorously.`;

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

  // Clean up the context files
  console.log(colors.green('\n✓ Session ended successfully'));
  console.log(colors.gray('\nCleaning up temporary context files...'));
  rmSync(targetDir, { recursive: true, force: true });
};
