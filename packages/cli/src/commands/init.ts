import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import colors from 'ansi-colors';
import ora from 'ora';
import enquirer from 'enquirer';
import { detectEnvironment } from '../utils/environment.js';
import type { Environment } from '../types.js';
import { checkClaude, checkDocker, checkGemini, checkGit } from '../utils/system.js';
import { AI_AGENT, ProjectConfig, UserSettings } from '../lib/config.js';
import showTips, { TIP_TITLES } from '../utils/tips.js';
import { roverBanner } from '../utils/banner.js';

// Get the default prompt
const { prompt } = enquirer;

// Ensure .rover/ is in .gitignore
const ensureGitignore = async (projectPath: string): Promise<void> => {
    const gitignorePath = join(projectPath, '.gitignore');
    const roverEntry = '.rover/';

    try {
        let content = '';

        // Check if .gitignore exists
        if (existsSync(gitignorePath)) {
            content = readFileSync(gitignorePath, 'utf-8');

            // Check if .rover/ is already in .gitignore
            const lines = content.split('\n');
            const hasRoverEntry = lines.some(line =>
                line.trim() === roverEntry ||
                line.trim() === '.rover' ||
                line.trim() === '.rover/*'
            );

            if (hasRoverEntry) {
                return; // Already in .gitignore
            }

            // Add .rover/ to existing .gitignore
            const updatedContent = content.endsWith('\n')
                ? content + roverEntry + '\n'
                : content + '\n' + roverEntry + '\n';

            writeFileSync(gitignorePath, updatedContent);
        } else {
            // Create new .gitignore with .rover/
            writeFileSync(gitignorePath, roverEntry + '\n');
        }
    } catch (error) {
        throw new Error(`Failed to update .gitignore: ${error}`);
    }
};

/**
 * Init the project
 */
export const init = async (path: string = '.') => {
    // Intro
    console.log(roverBanner());

    console.log(colors.cyan('\nHello human! 🤖'));
    console.log(`${colors.gray("I'm")} ${colors.green("Rover")}${colors.gray(", and I will help you managing AI agents.")}`);
    console.log(colors.gray("Let me first run some checks in your systems.\n"));

    const reqSpinner = ora({ text: 'Checking prerequisites', spinner: 'dots2' }).start();

    reqSpinner.text = "Checking Git";

    const gitInstalled = await checkGit();

    reqSpinner.text = "Checking Docker";

    const dockerInstalled = await checkDocker();

    reqSpinner.text = "Checking Claude";

    const claudeInstalled = await checkClaude();

    reqSpinner.text = "Checking Gemini";

    const geminiInstalled = await checkGemini();

    const completeInstallation = gitInstalled && dockerInstalled && (claudeInstalled || geminiInstalled);

    if (completeInstallation) {
        reqSpinner.succeed("Your system is ready!");
    } else {
        reqSpinner.fail("Your system misses some required tools");
    }

    console.log(colors.white.bold('\nRequired Tools'));
    console.log(`├── Git: ${gitInstalled ? colors.green("✓ Installed") : colors.red("✗ Missing")}`);
    console.log(`└── Docker: ${dockerInstalled ? colors.green("✓ Installed") : colors.red("✗ Missing")}`);

    console.log(colors.white.bold('\nAI Agents (at least one)'));
    console.log(`├── Claude: ${claudeInstalled ? colors.green("✓ Installed") : colors.red("✗ Missing")}`);
    console.log(`└── Gemini: ${geminiInstalled ? colors.green("✓ Installed") : colors.red("✗ Missing")}`);

    if (!completeInstallation) {
        process.exit(1);
    }

    // Check if already initialized
    if (ProjectConfig.exists() && UserSettings.exists()) {
        console.log(colors.cyan('\n✓ Rover is already initialized in this directory'));
        return;
    }

    // Ensure .rover/ is in .gitignore
    try {
        await ensureGitignore(path);
    } catch (error) {
        console.log(colors.white.bold('\n.gitignore'));
        console.log(`└── ${colors.yellow('⚠ Could not update .gitignore:')}`, error);
    }

    // Detect environment
    console.log('');

    try {
        const environment: Environment = await detectEnvironment(path);
        let defaultAIAgent: AI_AGENT = AI_AGENT.Claude;

        const availableAgents: AI_AGENT[] = [];
        if (claudeInstalled) {
            availableAgents.push(AI_AGENT.Claude);
        }

        if (geminiInstalled) {
            availableAgents.push(AI_AGENT.Gemini);
        }

        // If multiple AI agents are available, ask user to select one
        if (availableAgents.length > 1) {
            try {
                const result = await prompt({
                    type: 'select',
                    name: 'aiAgent',
                    message: 'I detected multiple AI Agents. Select your preferred one:',
                    choices: availableAgents.map(agent => ({
                        name: agent.charAt(0).toUpperCase() + agent.slice(1),
                        value: agent
                    }))
                }) as { aiAgent: string };

                defaultAIAgent = result?.aiAgent.toLocaleLowerCase() as AI_AGENT;
            } catch (error) {
                console.log(colors.yellow(`\n⚠ No AI agent selected, defaulting to ${availableAgents[0]}`));
                defaultAIAgent = availableAgents[0];
            }
        } else if (availableAgents.length === 1) {
            // If only one AI agent is available, use it automatically
            defaultAIAgent = availableAgents[0];
        }

        // Save configuration to .rover directory
        console.log('');

        try {
            // Save Project Configuration (rover.json)
            let projectConfig: ProjectConfig;
            let exists = false;

            if (ProjectConfig.exists()) {
                exists = true;
                projectConfig = ProjectConfig.load();
                // Update with detected values
                environment.languages.forEach(lang => projectConfig.addLanguage(lang));
                environment.packageManagers.forEach(pm => projectConfig.addPackageManager(pm));
                environment.taskManagers.forEach(tm => projectConfig.addTaskManager(tm));
            } else {
                projectConfig = ProjectConfig.create();
                // Set detected values
                environment.languages.forEach(lang => projectConfig.addLanguage(lang));
                environment.packageManagers.forEach(pm => projectConfig.addPackageManager(pm));
                environment.taskManagers.forEach(tm => projectConfig.addTaskManager(tm));
            }

            // Save User Settings (.rover/settings.json)
            let userSettings: UserSettings;
            if (UserSettings.exists()) {
                userSettings = UserSettings.load();
                // Update AI agents
                availableAgents.forEach(agent => userSettings.addAiAgent(agent));
                userSettings.setDefaultAiAgent(defaultAIAgent);
            } else {
                userSettings = UserSettings.createDefault();
                // Set available AI agents and default
                availableAgents.forEach(agent => userSettings.addAiAgent(agent));
                userSettings.setDefaultAiAgent(defaultAIAgent);
            }

            console.log(colors.green('✓ Rover initialization complete!'));
            console.log(`├── ${colors.gray('Project config:')} rover.json`);
            console.log(`└── ${colors.gray('User settings:')} .rover/settings.json (Added to .gitignore)`);

            showTips(
                [
                    colors.gray('Run ') + colors.cyan('rover help') + colors.gray(' to see available commands'),
                    colors.gray('Run ') + colors.cyan('rover task') + colors.gray(' to assign a new task to an Agent')
                ],
                {
                    title: TIP_TITLES.NEXT_STEPS
                }
            );
        } catch (error) {
            console.error('\n' + colors.red('Rover initialization failed!'));
            console.error(colors.red('Error:'), error);
            process.exit(1);
        }

    } catch (error) {
        console.error('\n' + colors.red('Failed to detect environment'));
        console.error(colors.red('Error:'), error);
        process.exit(1);
    }
};

export default init;