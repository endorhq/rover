/**
 * Defines the workflow subcommands for the CLI.
 */
import { Command } from 'commander';
import { listWorkflowsCommand } from './list.js';

export const addWorkflowCommands = (program: Command) => {
  // Add the subcommand
  const command = program
    .command('workflows')
    .description('Retrieve information about the available workflows');

  command
    .command('list')
    .alias('ls')
    .description('List all available workflows')
    .option('--json', 'Output the list in JSON format', false)
    .action(listWorkflowsCommand);
};
