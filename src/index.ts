#!/usr/bin/env node
import { Command } from 'commander';
import init from './commands/init.js';
import { listCommand } from './commands/list.js';
import { getVersion } from './utils/version.js';
import { taskCommand } from './commands/task.js';
import { diffCommand } from './commands/diff.js';
import { logsCommand } from './commands/logs.js';
import { inspectCommand } from './commands/inspect.js';
import { iterateCommand } from './commands/iterate.js';
import { shellCommand } from './commands/shell.js';
import { resetCommand } from './commands/reset.js';
import { deleteCommand } from './commands/delete.js';
import { mergeCommand } from './commands/merge.js';
import colors from 'ansi-colors';
import { pushCommand } from './commands/push.js';

const program = new Command();

program
	.name('rover')
	.description('Collaborate with AI agents to complete any task')
	.version(getVersion());

program
	.optionsGroup(colors.cyan("Options"));

program
	.commandsGroup(colors.cyan("Project configuration:"));

program
	.command('init')
	.description('Initialize your project')
	.argument('[path]', 'Project path', '.')
	.action((path: string) => {
		init(path);
	});

program
	.commandsGroup(colors.cyan("Create and manage tasks:"));

// Add a new task
program
	.command('task')
	.description('Start a new task for an AI Agent. It will spawn a new environment to complete it.')
	.option('--from-github <issue>', 'Fetch task description from a GitHub issue number')
	.option('-f, --follow', 'Follow execution logs in real-time')
	.option('-y, --yes', 'Skip all confirmations and run non-interactively')
	.option('--json', 'Output the result in JSON format')
	.argument('[description]', 'The task description, or provide it later. Mandatory in non-interactive envs')
	.action(taskCommand);

// Add the ps command for monitoring tasks
program
	.command('list')
	.alias('ls')
	.description('Show tasks and their status')
	.option('-v, --verbose', 'Show detailed information including errors')
	.option('-w, --watch', 'Watch for changes and refresh every 5 seconds')
	.option('--json', 'Output in JSON format')
	.action(listCommand);

program
	.command('inspect')
	.description('Inspect a task')
	.argument('<taskId>', 'Task ID to inspect')
	.option('--json', 'Output in JSON format')
	.action(inspectCommand);

program
	.command('logs')
	.description('Show execution logs for a task iteration')
	.argument('<taskId>', 'Task ID to show logs for')
	.argument('[iterationNumber]', 'Specific iteration number (defaults to latest)')
	.option('-f, --follow', 'Follow log output in real-time')
	.action(logsCommand);

program
	.command('reset')
	.description('Reset a task to original state and remove any worktree/branch')
	.argument('<taskId>', 'Task ID to reset')
	.option('-f, --force', 'Force reset without confirmation')
	.action(resetCommand);

program
	.command('delete')
	.alias('del')
	.description('Delete a task')
	.argument('<taskId>', 'Task ID to delete')
	.action(deleteCommand);

program
	.command('iterate')
	.alias('iter')
	.description('Add refinements to a task and start new iteration')
	.argument('<taskId>', 'Task ID to iterate on')
	.argument('<refinements>', 'New requirements or refinements to apply')
	.option('-f, --follow', 'Follow execution logs in real-time')
	.action(iterateCommand);

program
	.commandsGroup(colors.cyan("Debug a task:"));

program
	.command('shell')
	.description('Open interactive shell for testing task changes')
	.argument('<taskId>', 'Task ID to open shell for')
	.action(shellCommand);

program
	.commandsGroup(colors.cyan("Merge changes:"));

// Diff command to show changes in the task
program
	.command('diff')
	.description('Show git diff between task worktree and main branch')
	.argument('<taskId>', 'Task ID to show diff for')
	.argument('[filePath]', 'Optional file path to show diff for specific file')
	.option('-b, --branch <name>', 'Compare changes with a specific branch')
	.option('--only-files', 'Show only changed filenames')
	.action(diffCommand);

program
	.command('merge')
	.description('Merge the task changes into your current branch')
	.argument('<taskId>', 'Task ID to merge')
	.option('-f, --force', 'Force merge without confirmation')
	.action(mergeCommand);

program
	.command('push')
	.description('Commit and push task changes to remote, with GitHub PR support')
	.argument('<taskId>', 'Task ID to push')
	.option('-m, --message <message>', 'Commit message')
	.option('--pr', 'Creates a Pull Request in GitHub')
	.option('-f, --force', 'Force push')
	.option('--json', 'Output in JSON format')
	.action(pushCommand);

program.parse(process.argv);

// If no command is provided, show help
if (!process.argv.slice(2).length) {
	program.outputHelp();
}
