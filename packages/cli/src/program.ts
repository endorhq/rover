import { Command, Option } from 'commander';
import {
  AI_AGENT,
  Git,
  setVerbose,
  getVersion,
  findOrRegisterProject,
} from 'rover-core';
import { NETWORK_MODE_VALUES } from 'rover-schemas';
import initCmd from './commands/init.js';
import infoCmd from './commands/info.js';
import listCmd from './commands/list.js';
import { exitWithError } from './utils/exit.js';
import taskCmd from './commands/task.js';
import diffCmd from './commands/diff.js';
import logsCmd from './commands/logs.js';
import inspectCmd from './commands/inspect.js';
import iterateCmd from './commands/iterate.js';
import shellCmd from './commands/shell.js';
import resetCmd from './commands/reset.js';
import restartCmd from './commands/restart.js';
import deleteCmd from './commands/delete.js';
import mergeCmd from './commands/merge.js';
import colors from 'ansi-colors';
import pushCmd from './commands/push.js';
import stopCmd from './commands/stop.js';
import mcpCmd from './commands/mcp.js';
import { addWorkflowCommands } from './commands/workflows/index.js';
import workflowAddCmd from './commands/workflows/add.js';
import workflowListCmd from './commands/workflows/list.js';
import workflowInspectCmd from './commands/workflows/inspect.js';
import {
  getCLIContext,
  getProjectPath,
  initCLIContext,
  isJsonMode,
  requireProjectContext,
  setProject,
} from './lib/context.js';
import { showRoverHeader } from 'rover-core/src/display/header.js';
import { getUserAIAgent } from './lib/agents/index.js';
import type { CommandDefinition } from './types.js';

// Registry of all commands for metadata lookup
const commands: CommandDefinition[] = [
  initCmd,
  infoCmd,
  listCmd,
  taskCmd,
  diffCmd,
  logsCmd,
  inspectCmd,
  iterateCmd,
  shellCmd,
  resetCmd,
  restartCmd,
  deleteCmd,
  mergeCmd,
  pushCmd,
  stopCmd,
  mcpCmd,
  workflowAddCmd,
  workflowListCmd,
  workflowInspectCmd,
];

/**
 * Get command definition by matching the command name and optional parent.
 * For subcommands (e.g., "workflows add"), the parent field distinguishes
 * them from top-level commands with the same name.
 */
function getCommandDefinition(
  actionCommand: Command
): CommandDefinition | undefined {
  const name = actionCommand.name();
  const parent = actionCommand.parent?.parent
    ? actionCommand.parent.name()
    : undefined;
  return commands.find(c => c.name === name && c.parent === parent);
}

/**
 * Initialize the CLI program with all the available commands.
 * It adds a set of pre-hookds to initialize the context and display headers.
 * You can exclude runtime hooks for testing purposes.
 *
 * @param options.excludeRuntimeHooks Whether to exclude runtime hooks (default: false)
 * @returns Command The initialized CLI program
 */
export function createProgram(
  options: { excludeRuntimeHooks?: boolean } = {}
): Command {
  const program = new Command();
  const version = getVersion();

  if (!options.excludeRuntimeHooks) {
    program
      .hook('preAction', async (thisCommand, actionCommand) => {
        // Ensure the CLI minimal context is initialized
        const cliOptions = thisCommand.opts();
        const options = actionCommand.opts();

        // Common config
        const verbose = cliOptions.verbose === true;
        const jsonMode = options.json === true;
        const projectOption = cliOptions.project ?? process.env.ROVER_PROJECT;

        // Configure the rover-core lib in verbose mode
        setVerbose(verbose);

        // Check if cwd is in a git repo
        const git = new Git();
        const inGitRepo = git.isGitRepo();

        initCLIContext({
          jsonMode,
          verbose,
          inGitRepo,
          projectOption,
          // Keep the project null for now - will be resolved in the next hook
          project: null,
        });
      })
      .hook('preAction', async (_thisCommand, actionCommand) => {
        // Resolve the project.
        const commandName = actionCommand.name();

        // Retrive from previous hook
        const ctx = getCLIContext();

        // Get command definition and check if it requires project
        // It must be defined.
        const commandDef = getCommandDefinition(actionCommand)!;

        try {
          let project;

          if (ctx.projectOption) {
            // When users pass the project option, always try to resolve it.
            const message = `Could not find the "${ctx.projectOption}" project. Please, select a \nvalid project from the list. You can type to filter the projects`;

            project = await requireProjectContext(ctx.projectOption, {
              missingProjectMessage: colors.yellow(message),
            });
          } else if (ctx.inGitRepo) {
            // No project option but in git repo, resolve it.
            project = await findOrRegisterProject();
          }

          if (!project && commandDef.requireProject) {
            // If project is required, force to resolve it.
            let message = `The "${commandName}" command requires a project context.\nPlease, select it from the list. You can type to filter the projects`;

            project = await requireProjectContext(ctx.projectOption, {
              missingProjectMessage: colors.yellow(message),
            });
          }

          // Skip forcing to resolve
          if (project) {
            setProject(project);
          }
        } catch (error) {
          // Config/registration errors - exit
          exitWithError({
            error: error instanceof Error ? error.message : String(error),
            success: false,
          });
        }
      })
      .hook('preAction', (_thisCommand, actionCommand) => {
        // Show header!
        const commandName = actionCommand.name();
        const agent = actionCommand.opts()?.agent ?? getUserAIAgent();
        let agentName = '-';

        // Confirm the agent is valid
        if (Object.values(AI_AGENT).includes(agent.toString().toLowerCase())) {
          agentName = agent.toString();
        }

        if (isJsonMode() || commandName === 'mcp') {
          // Do not print anything for JSON or MCP mode
          return;
        }

        showRoverHeader({
          version,
          // Capitalize the agent for now.
          agent: `${agentName[0].toUpperCase()}${agentName.slice(1).toLowerCase()}`,
          defaultAgent: actionCommand.opts()?.agent == null,
          projectPath: getProjectPath() || process.cwd(),
          projectName: getCLIContext().project?.name,
        });
      });
  }

  program.option(
    '-v, --verbose',
    'Log verbose information like running commands'
  );
  program.option(
    '-p, --project <name>',
    'Target a specific project by name, ID, or path (overrides cwd)'
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
    .action(initCmd.action);

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
    .action(listCmd.action);

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
    .addOption(
      new Option(
        '--network-mode <mode>',
        'Network filtering mode for the container'
      ).choices(NETWORK_MODE_VALUES)
    )
    .option(
      '--network-allow <host>',
      'Allow network access to host (domain, IP, or CIDR). Can be repeated.',
      (value: string, previous: string[] | undefined) =>
        previous ? [...previous, value] : [value]
    )
    .option(
      '--network-block <host>',
      'Block network access to host (domain, IP, or CIDR). Can be repeated.',
      (value: string, previous: string[] | undefined) =>
        previous ? [...previous, value] : [value]
    )
    .option('--json', 'Output the result in JSON format')
    .option(
      '--sandbox-extra-args <args>',
      'Extra arguments to pass to the Docker/Podman container (e.g., "--network mynet")'
    )
    .argument(
      '[description]',
      'The task description, or provide it later. Mandatory in non-interactive environments'
    )
    .action(taskCmd.action);

  // Restart a task
  program
    .command('restart')
    .description('Restart a new or failed task')
    .argument('<taskId>', 'Task ID to restart')
    .option('--json', 'Output the result in JSON format')
    .action(restartCmd.action);

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
    .action(stopCmd.action);

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
    .action(inspectCmd.action);

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
    .action(logsCmd.action);

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
    .action(deleteCmd.action);

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
    .action(iterateCmd.action);

  program
    .command('shell')
    .description('Open interactive shell for testing task changes')
    .argument('<taskId>', 'Task ID to open shell for')
    .option('-c, --container', 'Start the interactive shell within a container')
    .action(shellCmd.action);

  program.commandsGroup(colors.cyan('Merge changes:'));

  program
    .command('diff')
    .description('Show git diff between task worktree and main branch')
    .argument('<taskId>', 'Task ID to show diff for')
    .argument('[filePath]', 'Optional file path to show diff for specific file')
    .option('--base', 'Compare against the base commit when task was created')
    .option('-b, --branch <name>', 'Compare changes with a specific branch')
    .option('--only-files', 'Show only changed filenames')
    .action(diffCmd.action);

  program
    .command('merge')
    .description('Merge the task changes into your current branch')
    .argument('<taskId>', 'Task ID to merge')
    .option(
      '-a, --agent <agent>',
      'AI agent with optional model (e.g., claude:sonnet)'
    )
    .option('-f, --force', 'Force merge without confirmation')
    .option('--json', 'Output in JSON format')
    .action(mergeCmd.action);

  program
    .command('push')
    .description(
      'Commit and push task changes to remote, with GitHub PR support'
    )
    .argument('<taskId>', 'Task ID to push')
    .option('-m, --message <message>', 'Commit message')
    .option('--json', 'Output in JSON format')
    .action(pushCmd.action);

  program.commandsGroup(colors.cyan('Workflows:'));

  // Add all subcommands
  addWorkflowCommands(program);

  program.commandsGroup(colors.cyan('Model Context Protocol:'));

  program
    .command('mcp')
    .description('Start Rover as an MCP server')
    .action(mcpCmd.action);

  program.commandsGroup(colors.cyan('Rover store:'));
  program
    .command('info')
    .description('Show information about the Rover global store')
    .option('--json', 'Output in JSON format')
    .action(infoCmd.action);

  return program;
}
