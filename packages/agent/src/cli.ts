#!/usr/bin/env node

import { Command, Argument } from 'commander';
import { AI_AGENT, setVerbose } from 'rover-common';
import { runCommand } from './commands/run.js';
import {
  DEFAULT_INSTALL_DIRECTORY,
  DEFAULT_INSTALL_VERSION,
  installCommand,
} from './commands/install.js';
import { addConfigCommands } from './commands/config/index.js';
import { getAgentVersion } from './version.js';

// Common types
export interface CommandOutput {
  success: boolean;
  error?: string;
}

// Simple helper to collect multiple options using the same key
const collect = (value: string, previous: string[]) => {
  return previous.concat([value]);
};

// Program definition
const program = new Command();

program
  .name('rover-agent')
  .description('Run workflows using AI Coding Agents')
  .version(getAgentVersion());

// Verbose option
program
  .option('-v, --verbose', 'Log verbose information like running commands')
  .hook('preAction', (thisCommand, actionCommand) => {
    setVerbose(thisCommand.opts().verbose);
  });

// Run a workflow
program
  .command('run')
  .description('Run an Agent Workflow file')
  .argument('<workflowPath>', 'Path to the Agent Workflow YAML file')
  .option(
    '-i, --input <input>',
    'Pass an input value using key=value format',
    collect,
    []
  )
  .option('--inputs-json <jsonPath>', 'Load the input values from a JSON file')
  .option(
    '--agent-tool <agent>',
    'Agent tool to use. It overrides defaults, but prioritize step tools if available.'
  )
  .option(
    '--agent-model <model>',
    'Agent model to use. It overrides defaults, but prioritize step tools if available.'
  )
  .option(
    '--task-id <id>',
    'Task ID for status tracking (required if --status-file is provided)'
  )
  .option(
    '--status-file <path>',
    'Path to status.json file for tracking workflow progress'
  )
  .option(
    '--output <directory>',
    'Directory to move the output files and values from the workflow. If none, it will save them in the current folder.'
  )
  .option(
    '--pre-context-file <path>',
    'Path to JSON file containing pre-context data to inject into the workflow (can be specified multiple times)',
    collect,
    []
  )
  .action(runCommand);

// Install workflow dependencies
program
  .command('install')
  .description('Install agents and configure them')
  .addArgument(
    new Argument('<agent>', 'AI Coding Agent to install').choices(
      Object.values(AI_AGENT)
    )
  )
  .option(
    '--version <version>',
    'Install a specific agent version',
    DEFAULT_INSTALL_VERSION
  )
  .option(
    '--user-dir <directory>',
    'User directory to copy credentials',
    DEFAULT_INSTALL_DIRECTORY
  )
  .action(installCommand);

// Add the config commands
addConfigCommands(program);

program.parse(process.argv);

// If no command is provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
