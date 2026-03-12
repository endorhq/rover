/**
 * Defines the autopilot subcommands for the CLI.
 */
import type { Command } from 'commander';
import dashboardCmd from './dashboard.js';

export const addAutopilotCommands = (program: Command) => {
  program
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
};
