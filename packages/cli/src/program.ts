import { Command, Option } from 'commander';
import {
  AI_AGENT,
  Git,
  setVerbose,
  getVersion,
  showSplashHeader,
  showRegularHeader,
  findOrRegisterProject,
  ProjectLoaderNotGitRepoError,
} from 'rover-core';
import { initCommand } from './commands/init.js';
import { listCommand } from './commands/list.js';
import { exitWithError } from './utils/exit.js';
import { taskCommand } from './commands/task.js';
import { diffCommand } from './commands/diff.js';
import { logsCommand } from './commands/logs.js';
import { inspectCommand } from './commands/inspect.js';
import { iterateCommand } from './commands/iterate.js';
import { shellCommand } from './commands/shell.js';
import { resetCommand } from './commands/reset.js';
import { restartCommand } from './commands/restart.js';
import { deleteCommand } from './commands/delete.js';
import { mergeCommand } from './commands/merge.js';
import colors from 'ansi-colors';
import { pushCommand } from './commands/push.js';
import { stopCommand } from './commands/stop.js';
import { mcpCommand } from './commands/mcp.js';
import { addWorkflowCommands } from './commands/workflows/index.js';
import { initCLIContext, isJsonMode, setJsonMode } from './lib/context.js';

function isWorkflowsToplevelCommand(command: Command): boolean {
  return command.parent?.name() === 'workflows';
}

export function createProgram(
  options: { excludeRuntimeHooks?: boolean } = {}
): Command {
  const program = new Command();
  const version = getVersion();

  if (!options.excludeRuntimeHooks) {
    program
      .hook('preAction', async (thisCommand, actionCommand) => {
        const commandName = actionCommand.name();
        const cliOptions = thisCommand.opts();
        const options = actionCommand.opts();

        // Set verbose mode
        setVerbose(options.verbose === true);

        // Build context
        const git = new Git();
        const inGitRepo = git.isGitRepo();

        let project = null;

        // Skip project resolution for init (it creates the project),
        // mcp (adapts to context), and workflow commands
        if (
          !isWorkflowsToplevelCommand(actionCommand) &&
          commandName !== 'init' &&
          inGitRepo
        ) {
          try {
            project = await findOrRegisterProject();
          } catch (error) {
            // Config/registration errors - exit
            exitWithError({
              error: error instanceof Error ? error.message : String(error),
              success: false,
            });
          }
        }

        // Initialize context
        initCLIContext({
          jsonMode: options.json === true,
          verbose: cliOptions.verbose === true,
          project,
          inGitRepo,
        });
      })
      .hook('preAction', (_thisCommand, actionCommand) => {
        const commandName = actionCommand.name();

        if (isJsonMode()) {
          // Do not print anything for JSON
          return;
        }

        if (
          !isWorkflowsToplevelCommand(actionCommand) &&
          ['init', 'task'].includes(commandName)
        ) {
          showSplashHeader();
        } else if (commandName !== 'mcp') {
          showRegularHeader(version, process.cwd());
        }
      });
  }

  program.option(
    '-v, --verbose',
    'Log verbose information like running commands'
  );

  program
    .name('rover')
    .description('Collaborate with AI agents to complete any task')
    .version(version);

  program.optionsGroup(colors.cyan('Options'));

  program.commandsGroup(colors.cyan('Project configuration:'));

  program
    .command('init')
    .description('Create a shared configuration for this project')
    .option('-y, --yes', 'Skip all confirmations and run non-interactively')
    .argument('[path]', 'Project path', process.cwd())
    .action(initCommand);

  program.commandsGroup(colors.cyan('Current tasks:'));
  // Add the ps command for monitoring tasks
  program
    .command('list')
    .alias('ls')
    .description('Show the tasks from current project or all projects')
    .option(
      '-w, --watch [seconds]',
      'Watch for changes (default 3s, or specify interval)'
    )
    .option('--json', 'Output in JSON format')
    .action(listCommand);

  program.commandsGroup(colors.cyan('Manage tasks in a project:'));

  // Add a new task
  program
    .command('task')
    .description('Create and assign task to an AI Agent to complete it')
    .option(
      '--from-github <issue>',
      'Fetch task description from a GitHub issue number'
    )
    .addOption(
      new Option(
        '--workflow, -w <name>',
        'Use a specific workflow to complete this task'
      ).default('swe')
    )
    .option('-y, --yes', 'Skip all confirmations and run non-interactively')
    .option(
      '-s, --source-branch <branch>',
      'Base branch for git worktree creation'
    )
    .option(
      '-t, --target-branch <branch>',
      'Custom name for the worktree branch'
    )
    .option(
      '-a, --agent <agent>',
      `AI agent with optional model (e.g., claude:opus, gemini:flash). Repeat for multiple agents. Available: ${Object.values(AI_AGENT).join(', ')}`,
      (value: string, previous: string[] | undefined) =>
        previous ? [...previous, value] : [value]
    )
    .option('--json', 'Output the result in JSON format')
    .option('--debug', 'Show debug information like running commands')
    .option(
      '--sandbox-extra-args <args>',
      'Extra arguments to pass to the Docker/Podman container (e.g., "--network mynet")'
    )
    .argument(
      '[description]',
      'The task description, or provide it later. Mandatory in non-interactive environments'
    )
    .action(taskCommand);

  // Restart a task
  program
    .command('restart')
    .description('Restart a new or failed task')
    .argument('<taskId>', 'Task ID to restart')
    .option('--json', 'Output the result in JSON format')
    .action(restartCommand);

  // Stop a running task
  program
    .command('stop')
    .description('Stop a running task and clean up its resources')
    .argument('<taskId>', 'Task ID to stop')
    .option(
      '-a, --remove-all',
      'Remove container, git worktree and branch if they exist'
    )
    .option('-c, --remove-container', 'Remove container if it exists')
    .option(
      '-g, --remove-git-worktree-and-branch',
      'Remove git worktree and branch'
    )
    .option('--json', 'Output the result in JSON format')
    .action(stopCommand);

  program
    .command('inspect')
    .description('Inspect a task')
    .argument('<taskId>', 'Task ID to inspect')
    .argument(
      '[iterationNumber]',
      'Specific iteration number (defaults to latest)'
    )
    .option('--file <files...>', 'Output iteration file contents')
    .option(
      '--raw-file <files...>',
      'Output raw file contents without formatting (mutually exclusive with --file)'
    )
    .option('--json', 'Output in JSON format')
    .action(inspectCommand);

  program
    .command('logs')
    .description('Show execution logs for a task iteration')
    .argument('<taskId>', 'Task ID to show logs for')
    .argument(
      '[iterationNumber]',
      'Specific iteration number (defaults to latest)'
    )
    .option('-f, --follow', 'Follow log output in real-time')
    .option('--json', 'Output the result in JSON format')
    .action(logsCommand);

  // TODO: Improve the reset process by adding a way to start / stop tasks
  // 		 For now, I will skip this command.
  // program
  // 	.command('reset')
  // 	.description('Reset a task to original state and remove any worktree/branch')
  // 	.argument('<taskId>', 'Task ID to reset')
  // 	.option('-f, --force', 'Force reset without confirmation')
  // 	.action(resetCommand);

  program
    .command('delete')
    .alias('del')
    .description('Delete a task')
    .argument('<taskId...>', 'Task IDs to delete')
    .option('-y, --yes', 'Skip all confirmations and run non-interactively')
    .option('--json', 'Output in JSON format')
    .action(deleteCommand);

  program
    .command('iterate')
    .alias('iter')
    .description('Add instructions to a task and start new iteration')
    .argument('<taskId>', 'Task ID to iterate on')
    .argument(
      '[instructions]',
      'New requirements or refinement instructions to apply (will prompt if not provided)'
    )
    .option(
      '-i, --interactive',
      'Open an interactive command session to iterate on the task'
    )
    .option('--json', 'Output JSON and skip confirmation prompts')
    .action(iterateCommand);

  program
    .command('shell')
    .description('Open interactive shell for testing task changes')
    .argument('<taskId>', 'Task ID to open shell for')
    .option('-c, --container', 'Start the interactive shell within a container')
    .action(shellCommand);

  program.commandsGroup(colors.cyan('Merge changes:'));

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
    .option('--json', 'Output in JSON format')
    .action(mergeCommand);

  program
    .command('push')
    .description(
      'Commit and push task changes to remote, with GitHub PR support'
    )
    .argument('<taskId>', 'Task ID to push')
    .option('-m, --message <message>', 'Commit message')
    .option('--json', 'Output in JSON format')
    .action(pushCommand);

  program.commandsGroup(colors.cyan('Workflows:'));

  // Add all subcommands
  addWorkflowCommands(program);

  program.commandsGroup(colors.cyan('Model Context Protocol:'));

  program
    .command('mcp')
    .description('Start Rover as an MCP server')
    .action(mcpCommand);

  return program;
}
