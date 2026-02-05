/**
 * Defines the image subcommands for the CLI.
 * Manages project Docker images for task execution.
 */
import { Command } from 'commander';
import buildCmd from './build.js';
import rebuildCmd from './rebuild.js';
import statusCmd from './status.js';
import cleanCmd from './clean.js';

export const addImageCommands = (program: Command) => {
  const command = program
    .command('image')
    .description('Manage project Docker images for task execution');

  command
    .command(buildCmd.name)
    .description(buildCmd.description)
    .option('--no-build', 'Only generate Dockerfile, skip docker build')
    .option('-f, --force', 'Overwrite existing Dockerfile.rover')
    .option('--tag <tag>', 'Custom image tag')
    .option(
      '--with-agent <agents>',
      'Pre-install AI agent CLI(s), comma-separated (claude,gemini,codex,qwen)'
    )
    .option('--json', 'Output the result in JSON format')
    .action(buildCmd.action);

  command
    .command(rebuildCmd.name)
    .description(rebuildCmd.description)
    .option('--tag <tag>', 'Custom image tag')
    .option('--json', 'Output the result in JSON format')
    .action(rebuildCmd.action);

  command
    .command(statusCmd.name)
    .description(statusCmd.description)
    .option('--json', 'Output the result in JSON format')
    .action(statusCmd.action);

  command
    .command(cleanCmd.name)
    .description(cleanCmd.description)
    .option('--remove-image', 'Also remove the Docker image')
    .option('--reset-config', 'Remove sandbox.agentImage from rover.json')
    .option('-y, --yes', 'Skip confirmation prompts')
    .option('--json', 'Output the result in JSON format')
    .action(cleanCmd.action);
};
