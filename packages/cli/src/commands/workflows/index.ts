/**
 * Defines the workflow subcommands for the CLI.
 */
import { Command } from 'commander';
import addCmd from './add.js';
import listCmd from './list.js';
import inspectCmd from './inspect.js';

export const addWorkflowCommands = (program: Command) => {
  // Add the subcommand
  const command = program
    .command('workflows')
    .description('Retrieve information about the available workflows');

  command
    .command(addCmd.name)
    .argument('<source>')
    .description(addCmd.description)
    .option(
      '--name <name>',
      'Custom name for the workflow (without .yml extension)'
    )
    .option('--global', 'Save to global store even when in a project', false)
    .option('--json', 'Output the result in JSON format', false)
    .action(addCmd.action);

  command
    .command(listCmd.name)
    .alias('ls')
    .description(listCmd.description)
    .option('--json', 'Output the list in JSON format', false)
    .action(listCmd.action);

  command
    .command(inspectCmd.name)
    .argument('<workflow-source>')
    .description(inspectCmd.description)
    .option('--json', 'Output workflow details in JSON format', false)
    .option('--raw', 'Output workflow as raw YAML', false)
    .action(inspectCmd.action);
};
