/**
 * Defines the autopilot subcommands for the CLI.
 */
import { Command } from 'commander';
import dashboardCmd from './dashboard.js';
import inspectCmd from './inspect.js';

export const addAutopilotCommands = (program: Command) => {
  const command = program
    .command('autopilot')
    .description(
      'Launch an interactive dashboard to monitor and visualize task progress'
    )
    .option('-r, --refresh <seconds>', 'Refresh interval in seconds', '3')
    .option(
      '--from <datetime>',
      'Ignore GitHub events before this date or datetime (e.g. 2025-01-15 or 2025-01-15T09:30:00)'
    )
    .option(
      '--bot-name <name>',
      'GitHub bot account name used by the autopilot (used to identify self-generated events)'
    )
    .option('--bot <name>', '')
    .option('--maintainers <names...>', 'GitHub handles of project maintainers')
    .action(dashboardCmd.action);

  command
    .command(inspectCmd.name)
    .argument('<type>', 'Type to inspect: trace, span, or action')
    .argument('<uuid>', 'UUID of the entity')
    .description(inspectCmd.description)
    .option('--json', 'Output in JSON format', false)
    .option(
      '--project-id <id>',
      'Project ID to look up traces, spans, and actions from'
    )
    .action(inspectCmd.action);
};
