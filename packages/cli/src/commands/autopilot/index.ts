/**
 * Defines the autopilot subcommands for the CLI.
 */
import { Argument, type Command } from 'commander';
import dashboardCmd from './dashboard.js';
import inspectCmd from './inspect.js';

export const addAutopilotCommands = (program: Command) => {
  const command = program
    .command('autopilot')
    .description(
      'Launch an interactive dashboard to monitor and visualize task progress'
    )
    .option(
      '--mode <mode>',
      'Autopilot mode: "self-driving" (default) or "assistant" (dry-run write steps)'
    )
    .option(
      '--allow-events <value>',
      'Filter events by actor: "maintainers" (default), "all", or comma-separated usernames'
    )
    .action(dashboardCmd.action);

  command
    .command('inspect')
    .description('Inspect autopilot traces, spans, or actions by UUID')
    .addArgument(
      new Argument('<type>', 'Type to inspect').choices([
        'trace',
        'span',
        'action',
      ])
    )
    .argument('<uuid>', 'UUID of the trace, span, or action')
    .option('--json', 'Output in JSON format')
    .option('--project-id <id>', 'Override project context by ID')
    .action(inspectCmd.action);
};
