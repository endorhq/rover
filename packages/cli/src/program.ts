import { Command } from 'commander';
import { ProjectConfig, UserSettings } from './lib/config.js';
import { initCommand } from './commands/init.js';
import { listCommand } from './commands/list.js';
import { getVersion } from './utils/version.js';
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
import { showTips, TIP_TITLES } from './utils/display.js';
import { Git, setVerbose } from 'rover-common';

export function createProgram(
  options: { excludeRuntimeHooks?: boolean } = {}
): Command {
  const program = new Command();

  if (!options.excludeRuntimeHooks) {
    program
      .hook('preAction', (thisCommand, actionCommand) => {
        setVerbose(thisCommand.opts().verbose);
      })
      .hook('preAction', (thisCommand, actionCommand) => {
        const commandName = actionCommand.name();
        if (!['init', 'mcp'].includes(commandName) && !ProjectConfig.exists()) {
          console.log(
            colors.white(
              `Rover is not initialized in this directory. The command you requested (\`${commandName}\`) was not executed.`
            )
          );
          console.log(
            `└── ${colors.gray('Project config (does not exist):')} rover.json`
          );

          showTips(
            [
              'Run ' +
                colors.cyan('rover init') +
                ' in this directory to initialize project config and user settings',
            ],
            {
              title: TIP_TITLES.NEXT_STEPS,
            }
          );

          process.exit(1);
        }
      })
      .hook('preAction', (thisCommand, actionCommand) => {
        const git = new Git();
        try {
          git.version();
        } catch (error) {
          exitWithError(
            {
              error: 'Git is not installed',
              success: false,
            },
            actionCommand.opts().json === true,
            {
              tips: ['Install git and try again'],
            }
          );
        }
        if (!git.isGitRepo()) {
          exitWithError(
            {
              error: 'Not in a git repository',
              success: false,
            },
            actionCommand.opts().json === true,
            {
              tips: [
                'Rover requires the project to be in a git repository. You can initialize a git repository by running ' +
                  colors.cyan('git init'),
              ],
            }
          );
        }
        if (!git.hasCommits()) {
          exitWithError(
            {
              error: 'No commits found in git repository',
              success: false,
            },
            actionCommand.opts().json === true,
            {
              tips: [
                'Git worktree requires at least one commit in the repository in order to have common history',
              ],
            }
          );
        }
      })
      .hook('preAction', (thisCommand, actionCommand) => {
        const commandName = actionCommand.name();
        if (
          !['init', 'mcp'].includes(commandName) &&
          ProjectConfig.exists() &&
          !UserSettings.exists()
        ) {
          console.log(
            colors.white(
              `Rover is not fully initialized in this directory. The command you requested (\`${commandName}\`) was not executed.`
            )
          );
          console.log(
            `├── ${colors.gray('Project config (exists):')} rover.json`
          );
          console.log(
            `└── ${colors.gray('User settings (does not exist):')} .rover/settings.json`
          );

          showTips(
            [
              'Run ' +
                colors.cyan('rover init') +
                ' in this directory to initialize user settings',
            ],
            {
              title: TIP_TITLES.NEXT_STEPS,
            }
          );

          process.exit(1);
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
    .version(getVersion());

  program.optionsGroup(colors.cyan('Options'));

  program.commandsGroup(colors.cyan('Project configuration:'));

  program
    .command('init')
    .description('Initialize your project')
    .option('-y, --yes', 'Skip all confirmations and run non-interactively')
    .argument('[path]', 'Project path', process.cwd())
    .action(initCommand);

  program.commandsGroup(colors.cyan('Create and manage tasks:'));

  // Add a new task
  program
    .command('task')
    .description(
      'Start a new task for an AI Agent. It will spawn a new environment to complete it.'
    )
    .option(
      '--from-github <issue>',
      'Fetch task description from a GitHub issue number'
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
      'AI agent to use (claude, codex, gemini, qwen)'
    )
    .option('--json', 'Output the result in JSON format')
    .option('--debug', 'Show debug information like running commands')
    .argument(
      '[description]',
      'The task description, or provide it later. Mandatory in non-interactive envs'
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

  // Add the ps command for monitoring tasks
  program
    .command('list')
    .alias('ls')
    .description('Show tasks and their status')
    .option('-w, --watch', 'Watch for changes and refresh every 5 seconds')
    .option('--json', 'Output in JSON format')
    .action(listCommand);

  program
    .command('inspect')
    .description('Inspect a task')
    .argument('<taskId>', 'Task ID to inspect')
    .argument(
      '[iterationNumber]',
      'Specific iteration number (defaults to latest)'
    )
    .option('--file <files...>', 'Output iteration file contents')
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
    .option('--json', 'Output JSON and skip confirmation prompts')
    .action(iterateCommand);

  program.commandsGroup(colors.cyan('Debug a task:'));

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

  program.commandsGroup(colors.cyan('Model Context Protocol:'));

  program
    .command('mcp')
    .description('Start Rover as an MCP server')
    .action(mcpCommand);

  return program;
}
