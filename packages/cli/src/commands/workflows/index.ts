/**
 * Defines the workflow subcommands for the CLI.
 */
import { Command } from 'commander';
import { addWorkflowCommand } from './add.js';
import { listWorkflowsCommand } from './list.js';
import { inspectWorkflowCommand } from './inspect.js';

export const addWorkflowCommands = (program: Command) => {
  // Add the subcommand
  const command = program
    .command('workflows')
    .description('Retrieve information about the available workflows');

  command
    .command('add <source>')
    .description(
      'Add a workflow from a URL, local path, or stdin (use "-") to the workflow store'
    )
    .option(
      '--name <name>',
      'Custom name for the workflow (without .yml extension)'
    )
    .option('--global', 'Save to global store even when in a project', false)
    .option('--json', 'Output the result in JSON format', false)
    .action(addWorkflowCommand);

  command
    .command('list')
    .alias('ls')
    .description('List all available workflows')
    .option('--json', 'Output the list in JSON format', false)
    .action(listWorkflowsCommand);

  command
    .command('inspect <workflow-source>')
    .description(
      'Display detailed information about a specific workflow (name, URL, file path, or stdin with "-")'
    )
    .option('--json', 'Output workflow details in JSON format', false)
    .option('--raw', 'Output workflow as raw YAML', false)
    .action(inspectWorkflowCommand);
};
