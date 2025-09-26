#!/usr/bin/env node
import { Command } from 'commander';
import { createProgram } from '../src/program.js';

/**
 * Extracts command groups from the program structure
 * This maps commands to their logical groups based on the actual program structure
 */
function extractCommandGroups(program: Command): { [key: string]: Command[] } {
  const commands = program.commands;
  const groupedCommands: { [key: string]: Command[] } = {};

  // Define the mapping based on the actual program structure from lib/program.ts
  // This should match the commandsGroup() calls in that file
  const commandGroups = {
    'Project configuration': ['init'],
    'Create and manage tasks': [
      'task',
      'restart',
      'stop',
      'list',
      'inspect',
      'logs',
      'delete',
      'iterate',
    ],
    'Debug a task': ['shell'],
    'Merge changes': ['diff', 'merge', 'push'],
  };

  // Organize commands into groups
  commands.forEach(command => {
    let group = 'Other';
    for (const [groupName, commandNames] of Object.entries(commandGroups)) {
      if (commandNames.includes(command.name())) {
        group = groupName;
        break;
      }
    }

    if (!groupedCommands[group]) {
      groupedCommands[group] = [];
    }
    groupedCommands[group].push(command);
  });

  return groupedCommands;
}

/**
 * Formats a command as markdown documentation
 */
function formatCommandAsMarkdown(command: Command, level: number = 2): string {
  const indent = '#'.repeat(level);
  let markdown = `${indent} ${command.name()}\n\n`;

  if (command.description()) {
    markdown += `${command.description()}\n\n`;
  }

  // Usage
  const usage = command.usage();
  if (usage) {
    markdown += `**Usage:**\n\`\`\`\nrover ${command.name()} ${usage}\n\`\`\`\n\n`;
  }

  // Options
  const options = command.options;
  if (options && options.length > 0) {
    markdown += `**Options:**\n\n`;
    options.forEach(option => {
      const flags = option.flags;
      const description = option.description || 'No description';
      markdown += `- \`${flags}\`: ${description}\n`;
    });
    markdown += '\n';
  }

  // Aliases
  const aliases = command.aliases();
  if (aliases && aliases.length > 0) {
    markdown += `**Aliases:** ${aliases.map(alias => `\`${alias}\``).join(', ')}\n\n`;
  }

  return markdown;
}

/**
 * Generates markdown documentation for all commands
 */
function generateCommandReference(program: Command): string {
  let markdown = '# Rover CLI Command Reference\n\n';
  markdown +=
    'This document is automatically generated from the CLI command definitions.\n\n';

  // Add table of contents
  markdown += '## Table of Contents\n\n';

  // Extract command groups from the actual program structure
  const groupedCommands = extractCommandGroups(program);

  // Generate table of contents
  for (const [groupName, commands] of Object.entries(groupedCommands)) {
    markdown += `- [${groupName}](#${groupName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]/g, '')})\n`;
    commands.forEach(command => {
      markdown += `  - [\`${command.name()}\`](#${command.name()})\n`;
    });
  }
  markdown += '\n';

  // Generate command documentation by groups
  for (const [groupName, commands] of Object.entries(groupedCommands)) {
    markdown += `## ${groupName}\n\n`;

    commands.forEach(command => {
      markdown += formatCommandAsMarkdown(command, 3);
    });
  }

  return markdown;
}

/**
 * Main function to generate and output command reference
 */
async function main() {
  try {
    // Create the program without runtime hooks for documentation generation
    const program = createProgram({ excludeRuntimeHooks: true });

    // Generate markdown documentation
    const markdown = generateCommandReference(program);

    // Output to stdout
    console.log(markdown);
  } catch (error) {
    console.error('Error generating command reference:', error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
