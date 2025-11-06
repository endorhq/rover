/**
 * Defines the workflow subcommands for the CLI.
 */
import { Command } from 'commander';
import { listWorkflowsCommand } from './list.js';
import { inspectWorkflowCommand } from './inspect.js';

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

  command
    .command('inspect <workflow-name>')
    .description('Display detailed information about a specific workflow')
    .option('--json', 'Output workflow details in JSON format', false)
    .option('--raw', 'Output workflow as raw YAML', false)
    .action(inspectWorkflowCommand);
};
