import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import colors from 'ansi-colors';
import yoctoSpinner from 'yocto-spinner';
import ora from 'ora';
import enquirer from 'enquirer';
import { detectEnvironment } from '../utils/detect-environment.js';
import { saveRoverConfig } from '../utils/save-config.js';
import type { Environment, ProjectType } from '../types.js';
import { checkClaude, checkDocker, checkGemini, checkGit } from '../utils/system.js';

// Get the default prompt
const { prompt } = enquirer;

// Helper function to get color for project type
const getProjectTypeColor = (type: ProjectType): string => {
    switch (type) {
        case 'javascript':
            return colors.yellow(type); // JavaScript yellow
        case 'typescript':
            return colors.blue(type); // TypeScript blue
        case 'php':
            return colors.magenta(type); // PHP purple/magenta
        default:
            return colors.gray(type);
    }
};

// Helper to add delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
    console.log(colors.cyan('Welcome human! 🤖'));
    console.log(colors.gray("I'm Rover, and will help you manage AI agents."));
    console.log(colors.gray("I will run some checks in your systems.\n"));

    const reqSpinner = ora({ text: 'Checking prerequisites', spinner: 'dots3' }).start();
    
    await delay(200);
    reqSpinner.text = "Checking Git";
    
    const gitInstalled = await checkGit();

    await delay(200);
    reqSpinner.text = "Checking Docker";

    const dockerInstalled = await checkDocker();

    await delay(200);
    reqSpinner.text = "Checking Claude";
    
    const claudeInstalled = await checkClaude();

    await delay(200);
    reqSpinner.text = "Checking Gemini";

    const geminiInstalled = await checkGemini();

    await delay(200);

    const completeInstallation = gitInstalled && dockerInstalled && (claudeInstalled || geminiInstalled);

    if (completeInstallation) {
        reqSpinner.succeed("Done! Your system is ready");
    } else {
        reqSpinner.fail("Your system misses some required tools");
    }

    console.log(colors.white('\n============ Required Tools ============'));
    console.log(`  Git: ${gitInstalled ? colors.green("✓ Installed") : colors.red("✗ Missing")}`);
    console.log(`  Docker: ${dockerInstalled ? colors.green("✓ Installed") : colors.red("✗ Missing")}`);

    console.log(colors.white('\n============ AI Agents (at least one) ============'));
    console.log(`  Claude: ${claudeInstalled ? colors.green("✓ Installed") : colors.red("✗ Missing")}`);
    console.log(`  Gemini: ${geminiInstalled ? colors.green("✓ Installed") : colors.red("✗ Missing")}`);
    
    if (!completeInstallation) {
        process.exit(1);
    }
    
    const roverPath = join(path, '.rover');
    const roverConfigPath = join(path, 'rover.json');
    
    if (existsSync(roverPath) && existsSync(roverConfigPath)) {
        console.log(colors.cyan('✓ Rover is already initialized in this directory'));
        return;
    }
    
    // Ensure .rover/ is in .gitignore
    try {
        await ensureGitignore(path);
        console.log(colors.white('\n============ .gitignore ============'));
        console.log(`${colors.green('✓')} Added .rover/ to .gitignore`);
    } catch (error) {
        console.log(colors.yellow('⚠ Could not update .gitignore:'), error);
    }
    
    // Detect environment
    console.log(colors.white('\n============ Project environment ============'));
    const spinner = ora({ text: 'Detecting project environment...', spinner: 'dots11' }).start();
    
    try {
        const environment: Environment = await detectEnvironment(path);
        
        const availableAgents: string[] = [];
        if (claudeInstalled) {
            availableAgents.push('claude');
        }
        if (geminiInstalled) {
            availableAgents.push('gemini');
        }
        environment.aiAgents = availableAgents;

        // Add a small delay so users can see the spinner
        await delay(800);
        
        spinner.succeed('Environment detected!');
        console.log('')
        
        // If multiple AI agents are available, ask user to select one
        if (availableAgents.length > 1) {
            try {
                const result = await prompt({
                    type: 'select',
                    name: 'aiAgent',
                    message: 'Select your preferred AI agent',
                    choices: availableAgents.map(agent => ({
                        name: agent.charAt(0).toUpperCase() + agent.slice(1),
                        value: agent
                    }))
                }) as { aiAgent: string };

                environment.selectedAiAgent = result?.aiAgent.toLocaleLowerCase();
            } catch (error) {
                console.log(colors.yellow('\n⚠ No AI agent selected, defaulting to Claude'));
                environment.selectedAiAgent = 'claude';
            }
        } else if (availableAgents.length === 1) {
            // If only one AI agent is available, use it automatically
            environment.selectedAiAgent = availableAgents[0];
        }
        
        // Display detected information
        console.log('\n' + colors.bold('Project Details:'));
        console.log(`  ${colors.gray('Type:')} ${getProjectTypeColor(environment.projectType)}`);
        console.log(`  ${colors.gray('Package Manager:')} ${colors.cyan(environment.packageManager)}`);
        console.log(`  ${colors.gray('Dev Environments:')} ${colors.white(environment.devEnvironments.join(', '))}`);
        console.log(`  ${colors.gray('Task Managers:')} ${colors.white(environment.taskManagers.join(', '))}`);
        console.log(`  ${colors.gray('AI Agent:')} ${colors.green(environment.selectedAiAgent || 'none')}`);
        
        // Save configuration to .rover directory
        console.log('');
        const saveSpinner = yoctoSpinner({ text: 'Saving configuration...' }).start();

        try {
            saveRoverConfig(path, environment);
            await delay(300); // Small delay for UX
            saveSpinner.success('Configuration saved to .rover.json');
            
            console.log('\n' + colors.green('✓ Rover initialization complete!'));
            console.log(colors.gray('  Run ') + colors.cyan('rover help') + colors.gray(' to see available commands'));
        } catch (error) {
            saveSpinner.error('Failed to save configuration');
            console.error(colors.red('Error:'), error);
            process.exit(1);
        }
        
    } catch (error) {
        spinner.fail('Failed to detect environment');
        console.error(colors.red('Error:'), error);
        process.exit(1);
    }
};

export default init;