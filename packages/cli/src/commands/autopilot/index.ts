/**
 * Defines the autopilot subcommands for the CLI.
 */
import type { Command } from 'commander';
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
    .option(
      '-r, --refresh <seconds>',
      'Refresh interval in seconds for polling GitHub events'
    )
    .option('--bot-name <name>', 'GitHub bot account name')
    .option('--bot <name>', 'GitHub bot account name (alias for --bot-name)')
    .option('--maintainers <names...>', 'GitHub handles of project maintainers')
    .action(dashboardCmd.action);

  command
    .command('inspect')
    .description('Inspect an autopilot trace, span, or action by UUID')
    .argument('<uuid>', 'UUID of the trace, span, or action')
    .option('--json', 'Output in JSON format')
    .option('--project-id <id>', 'Override project context by ID')
    .action(inspectCmd.action);
};
