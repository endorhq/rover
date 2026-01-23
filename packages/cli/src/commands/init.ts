import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import colors from 'ansi-colors';
import ora from 'ora';
import enquirer from 'enquirer';
import { detectEnvironment, Git, type EnvironmentResult } from 'rover-core';
import {
  checkClaude,
  checkCodex,
  checkCursor,
  checkDocker,
  checkGemini,
  checkQwen,
  checkGit,
} from '../utils/system.js';
import {
  ProjectConfigManager,
  UserSettingsManager,
  AI_AGENT,
} from 'rover-core';
import { showRoverChat, showTips, TIP_TITLES } from '../utils/display.js';
import { getTelemetry } from '../lib/telemetry.js';
import { exitWithError, exitWithWarn, exitWithSuccess } from '../utils/exit.js';
import type { CommandDefinition } from '../types.js';

// Get the default prompt
const { prompt } = enquirer;

// Ensure .rover/tasks/ and .rover/settings.local.json are in .gitignore
const ensureGitignore = async (projectPath: string): Promise<void> => {
  const gitignorePath = join(projectPath, '.gitignore');
  const roverTasksEntry = '.rover/tasks/';
  const roverSettingsEntry = '.rover/settings.local.json';

  try {
    let content = '';

    // Check if .gitignore exists
    if (existsSync(gitignorePath)) {
      content = readFileSync(gitignorePath, 'utf-8');

      // Check if .rover/ patterns are already in .gitignore
      const lines = content.split('\n');

      // Check for old pattern (entire .rover/ directory)
      const hasOldRoverEntry = lines.some(
        line =>
          line.trim() === '.rover/' ||
          line.trim() === '.rover' ||
          line.trim() === '.rover/*'
      );

      // Check for new granular patterns
      const hasTasksEntry = lines.some(line => line.trim() === roverTasksEntry);
      const hasSettingsEntry = lines.some(
        line => line.trim() === roverSettingsEntry
      );

      // If old pattern exists or both new patterns exist, we're done
      if (hasOldRoverEntry || (hasTasksEntry && hasSettingsEntry)) {
        return; // Already in .gitignore
      }

      // Add missing entries
      let updatedContent = content.endsWith('\n') ? content : content + '\n';

      if (!hasTasksEntry) {
        updatedContent += roverTasksEntry + '\n';
      }
      if (!hasSettingsEntry) {
        updatedContent += roverSettingsEntry + '\n';
      }

      writeFileSync(gitignorePath, updatedContent);
    } else {
      // Create new .gitignore with granular patterns
      writeFileSync(
        gitignorePath,
        roverTasksEntry + '\n' + roverSettingsEntry + '\n'
      );
    }
  } catch (error) {
    throw new Error(`Failed to update .gitignore: ${error}`);
  }
};

/**
 * Initialize Rover in a git repository.
 *
 * Sets up the project configuration (rover.json) and user settings (.rover/settings.json)
 * required to use Rover. The command performs system checks to verify Git, Docker, and
 * AI agent availability (Claude, Codex, Cursor, Gemini, Qwen), detects the project's
 * programming languages and package managers, and configures the default AI agent.
 *
 * @param path - Path to the project root (defaults to current directory)
 * @param options - Command options
 * @param options.yes - Skip interactive prompts and use defaults
 */
const initCommand = async (path: string = '.', options: { yes?: boolean }) => {
  const telemetry = getTelemetry();
  const resolvedPath = resolve(path);
  const git = new Git({ cwd: resolvedPath });

  // Check if we're in a git repository
  if (!git.isGitRepo()) {
    console.error(
      colors.red('✗ Not in a git repository') +
        '\n' +
        colors.gray('This command must be run from within a git repository')
    );
    console.log(
      colors.gray('\nTip: Run ') +
        colors.cyan('git init') +
        colors.gray(' to initialize a git repository')
    );
    process.exit(1);
  }

  const projectRoot = git.getRepositoryRoot() || resolvedPath;

  showRoverChat([
    "hey human! I'm Rover and I will help you manage AI agents.",
    'Let me first run some checks in your system.',
  ]);

  const reqSpinner = ora({
    text: 'Checking prerequisites',
    spinner: 'dots2',
  }).start();

  reqSpinner.text = 'Checking Git';

  const gitInstalled = await checkGit();

  reqSpinner.text = 'Checking Docker';

  const dockerInstalled = await checkDocker();

  reqSpinner.text = 'Checking Claude';

  const claudeInstalled = await checkClaude();

  reqSpinner.text = 'Checking Codex';

  const codexInstalled = await checkCodex();

  reqSpinner.text = 'Checking Gemini';

  const cursorInstalled = await checkCursor();

  reqSpinner.text = 'Checking Cursor';

  const geminiInstalled = await checkGemini();

  reqSpinner.text = 'Checking Qwen';

  const qwenInstalled = await checkQwen();

  const completeInstallation =
    gitInstalled &&
    dockerInstalled &&
    (claudeInstalled || codexInstalled || geminiInstalled || qwenInstalled);

  if (completeInstallation) {
    reqSpinner.succeed('Your system is ready!');
  } else {
    reqSpinner.fail('Your system misses some required tools');
  }

  console.log(colors.bold('\nRequired Tools'));
  console.log(
    `├── Git: ${gitInstalled ? colors.green('✓ Installed') : colors.red('✗ Missing')}`
  );
  console.log(
    `└── Docker: ${dockerInstalled ? colors.green('✓ Installed') : colors.red('✗ Missing')}`
  );

  console.log(colors.bold('\nAI Agents (at least one)'));
  console.log(
    `├── Claude: ${claudeInstalled ? colors.green('✓ Installed') : colors.red('✗ Missing')}`
  );
  console.log(
    `├── Codex: ${codexInstalled ? colors.green('✓ Installed') : colors.red('✗ Missing')}`
  );
  console.log(
    `├── Cursor: ${cursorInstalled ? colors.green('✓ Installed') : colors.red('✗ Missing')}`
  );
  console.log(
    `├── Gemini: ${geminiInstalled ? colors.green('✓ Installed') : colors.red('✗ Missing')}`
  );
  console.log(
    `└── Qwen: ${qwenInstalled ? colors.green('✓ Installed') : colors.red('✗ Missing')}`
  );

  if (!completeInstallation) {
    await exitWithError(
      {
        success: false,
        error: 'Your system misses some required tools',
      },
      { telemetry }
    );
    return;
  }

  // Check if already initialized
  if (
    ProjectConfigManager.exists(projectRoot) &&
    UserSettingsManager.exists(projectRoot)
  ) {
    await exitWithSuccess(
      'Rover is already initialized in this directory',
      { success: true },
      { telemetry }
    );
    return;
  } else if (!UserSettingsManager.exists(projectRoot)) {
    console.log(
      colors.green(
        '\n✓ Rover is initialized in this directory. User settings will be initialized now.'
      )
    );
  }

  // Ensure .rover/ is in .gitignore
  try {
    await ensureGitignore(projectRoot);
  } catch (error) {
    console.log(colors.bold('\n.gitignore'));
    console.log(
      `└── ${colors.yellow('⚠ Could not update .gitignore:')}`,
      error
    );
  }

  // Detect environment
  console.log('');

  try {
    const environment: EnvironmentResult = await detectEnvironment(projectRoot);
    let defaultAIAgent: AI_AGENT = AI_AGENT.Claude;

    const availableAgents: AI_AGENT[] = [];
    if (claudeInstalled) {
      availableAgents.push(AI_AGENT.Claude);
    }

    if (codexInstalled) {
      availableAgents.push(AI_AGENT.Codex);
    }

    if (cursorInstalled) {
      availableAgents.push(AI_AGENT.Cursor);
    }

    if (geminiInstalled) {
      availableAgents.push(AI_AGENT.Gemini);
    }

    if (qwenInstalled) {
      availableAgents.push(AI_AGENT.Qwen);
    }

    // If multiple AI agents are available, ask user to select one
    if (availableAgents.length > 1 && !options.yes) {
      try {
        const result = (await prompt({
          type: 'select',
          name: 'aiAgent',
          message: 'I detected multiple AI Agents. Select your preferred one:',
          choices: availableAgents.map(agent => ({
            name: agent.charAt(0).toUpperCase() + agent.slice(1),
            value: agent,
          })),
        })) as { aiAgent: string };

        defaultAIAgent = result?.aiAgent.toLocaleLowerCase() as AI_AGENT;
      } catch (error) {
        console.log(
          colors.yellow(
            `\n⚠ No AI agent selected, defaulting to ${availableAgents[0]}`
          )
        );
        defaultAIAgent = availableAgents[0];
      }
    } else if (availableAgents.length > 0) {
      // If only one AI agent is available or if more than one
      // AI agent is available, but "--yes" option was provided,
      // use it automatically.
      defaultAIAgent = availableAgents[0];
    }

    let attribution = true;

    if (!options.yes) {
      console.log(colors.bold('\nAttribution'));
      // Confirm attribution
      console.log(
        colors.gray(
          '├── Rover can add itself as a co-author on commits it helps create'
        )
      );
      console.log(
        colors.gray(
          '└── This helps track AI-assisted work in your repository\n'
        )
      );
      try {
        const { confirm } = await prompt<{ confirm: boolean }>({
          type: 'confirm',
          name: 'confirm',
          message:
            'Would you like to enable commit attribution? (can change anytime)',
          initial: true,
        });
        attribution = confirm;
      } catch (error) {
        await exitWithWarn(
          'Init process cancelled',
          { success: true },
          { exitCode: 1, telemetry }
        );
        return;
      }
    }

    // Send telemetry information
    telemetry?.eventInit(
      availableAgents,
      defaultAIAgent,
      environment.languages,
      attribution
    );

    // Save configuration to .rover directory
    console.log('');

    try {
      // Save Project Configuration (rover.json)
      let projectConfig: ProjectConfigManager;

      if (ProjectConfigManager.exists(projectRoot)) {
        projectConfig = ProjectConfigManager.load(projectRoot);
        // Update with detected values
        environment.languages.forEach(lang => projectConfig.addLanguage(lang));
        environment.packageManagers.forEach(pm =>
          projectConfig.addPackageManager(pm)
        );
        environment.taskManagers.forEach(tm =>
          projectConfig.addTaskManager(tm)
        );
        projectConfig.setAttribution(attribution);
      } else {
        projectConfig = ProjectConfigManager.create(projectRoot);
        projectConfig.setAttribution(attribution);
        // Set detected values
        environment.languages.forEach(lang => projectConfig.addLanguage(lang));
        environment.packageManagers.forEach(pm =>
          projectConfig.addPackageManager(pm)
        );
        environment.taskManagers.forEach(tm =>
          projectConfig.addTaskManager(tm)
        );
      }

      // Save User Settings (.rover/settings.json)
      let userSettings: UserSettingsManager;
      if (UserSettingsManager.exists(projectRoot)) {
        userSettings = UserSettingsManager.load(projectRoot);
        // Update AI agents
        availableAgents.forEach(agent => userSettings.addAiAgent(agent));
        userSettings.setDefaultAiAgent(defaultAIAgent);
      } else {
        userSettings = UserSettingsManager.createDefault(projectRoot);
        // Set available AI agents and default
        availableAgents.forEach(agent => userSettings.addAiAgent(agent));
        userSettings.setDefaultAiAgent(defaultAIAgent);
      }

      console.log(colors.green('✓ Rover initialization complete!'));
      console.log(`├── ${colors.gray('Project config:')} rover.json`);
      console.log(
        `└── ${colors.gray('User settings:')} .rover/settings.json (.rover/settings.local.json added to .gitignore)`
      );

      showTips(
        [
          'Run ' + colors.cyan('rover help') + ' to see available commands',
          'Run ' +
            colors.cyan('rover task') +
            ' to assign a new task to an Agent',
        ],
        {
          title: TIP_TITLES.NEXT_STEPS,
        }
      );

      await exitWithSuccess(
        'Rover initialization complete!',
        { success: true },
        { telemetry }
      );
      return;
    } catch (error) {
      await exitWithError(
        {
          success: false,
          error: `Rover initialization failed: ${error}`,
        },
        { telemetry }
      );
      return;
    }
  } catch (error) {
    await exitWithError(
      {
        success: false,
        error: `Failed to detect environment: ${error}`,
      },
      { telemetry }
    );
    return;
  }
};

// Named export for backwards compatibility (used by tests)
export { initCommand };

export default {
  name: 'init',
  description: 'Create a shared configuration for this project',
  requireProject: false,
  action: initCommand,
} satisfies CommandDefinition;
