#!/usr/bin/env node

import { Command } from 'commander';
import { setVerbose, getVersion } from 'rover-common';
import { runCommand } from './commands/run.js';

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
  .version(getVersion());

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
  .option('--inputs-yaml <yamlPath>', 'Load the input values from a YAML file')
  .action(runCommand);

// Install workflow dependencies
program
  .command('install')
  .description('Install workflow dependencies, like missing AI coding agents')
  .argument('<workflowPath>', 'Path to the Agent Workflow YAML file')
  .action(runCommand);

program.parse(process.argv);

// If no command is provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
