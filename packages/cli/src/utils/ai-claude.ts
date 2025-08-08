import { execa } from 'execa';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Environment, ProjectInstructions, TaskExpansion, AIProvider } from '../types.js';

export class ClaudeAI implements AIProvider {
    private static async invoke(prompt: string, json: boolean = false): Promise<string> {
        const claudeArgs = ['-p'];

        if (json) {
            claudeArgs.push('--output-format');
            claudeArgs.push('json');
        }

        try {
            const { stdout } = await execa('claude', claudeArgs, {
                input: prompt,
                env: {
                    ...process.env,
                    // Ensure non-interactive mode
                    CLAUDE_NON_INTERACTIVE: 'true'
                },
            });
            return stdout.trim();
        } catch (error) {
            throw new Error(`Failed to invoke Claude: ${error}`);
        }
    }

    async analyzeProject(projectPath: string, environment: Environment): Promise<ProjectInstructions | null> {
        // Gather project context
        const contextFiles = [];

        // Read package.json if it exists
        const packageJsonPath = join(projectPath, 'package.json');
        if (existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
            contextFiles.push(`package.json scripts: ${JSON.stringify(packageJson.scripts || {}, null, 2)}`);
        }

        // Read README if it exists
        const readmePath = join(projectPath, 'README.md');
        if (existsSync(readmePath)) {
            const readme = readFileSync(readmePath, 'utf-8');
            contextFiles.push(`README.md (first 500 chars): ${readme.substring(0, 500)}...`);
        }

        // Read Makefile if it exists
        const makefilePath = join(projectPath, 'Makefile');
        if (existsSync(makefilePath)) {
            const makefile = readFileSync(makefilePath, 'utf-8');
            contextFiles.push(`Makefile (first 300 chars): ${makefile.substring(0, 300)}...`);
        }

        const prompt = `Analyze this project and provide ONLY a JSON response with run instructions:

Project Type: ${environment.projectType}
Package Manager: ${environment.packageManager}
Dev Environments: ${environment.devEnvironments.join(', ')}
Task Managers: ${environment.taskManagers.join(', ')}

Project Files:
${contextFiles.join('\n\n')}

Respond ONLY with valid JSON in this exact format:
{
  "runDev": "command to run the project in development mode",
  "interaction": "brief description of how to interact with the running project"
}

Examples:
- For a web app: {"runDev": "npm run dev", "interaction": "Open http://localhost:3000 in your browser"}
- For a CLI tool: {"runDev": "npm run dev", "interaction": "Run 'npm start' to execute the CLI"}
- For an API: {"runDev": "npm run dev", "interaction": "API available at http://localhost:8080/api"}`;

        try {
            const response = await ClaudeAI.invoke(prompt, true);

            // Extract JSON from response (Claude might add extra text)
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }

            const { result } = JSON.parse(jsonMatch[0]);
            const instructions = JSON.parse(result.replace('```json', '').replace('```', ''));
            return instructions;
        } catch (error) {
            console.error('Failed to analyze project with Claude:', error);
            return null;
        }
    }

    async expandTask(briefDescription: string, projectPath: string): Promise<TaskExpansion | null> {
        // Load project context
        let projectContext = '';

        // Try to load rover project.json
        const roverConfigPath = join(projectPath, '.rover', 'project.json');
        if (existsSync(roverConfigPath)) {
            const config = JSON.parse(readFileSync(roverConfigPath, 'utf-8'));
            projectContext += `Project Type: ${config.environment.projectType}\n`;
            projectContext += `Package Manager: ${config.environment.packageManager}\n`;
            if (config.environment.instructions) {
                projectContext += `Dev Command: ${config.environment.instructions.runDev}\n`;
            }
        }

        // Load package.json if exists
        const packageJsonPath = join(projectPath, 'package.json');
        if (existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
            projectContext += `Project Name: ${packageJson.name || 'unknown'}\n`;
            projectContext += `Description: ${packageJson.description || 'none'}\n`;
        }

        const prompt = `Given this brief task description and project context, create a clear, actionable task title and expanded description.

Brief Description: ${briefDescription}

Project Context:
${projectContext}

Respond ONLY with valid JSON in this exact format:
{
  "title": "Concise, action-oriented title (max 10 words)",
  "description": "Detailed description explaining what needs to be done, why, and any relevant context. Include specific steps if applicable. (2-4 sentences)"
}

Examples:
- Brief: "add dark mode"
  Response: {"title": "Implement dark mode toggle", "description": "Add a dark mode toggle to the application's settings page. This should include creating a theme context provider, updating all components to use theme-aware styling, and persisting the user's preference in local storage. Consider accessibility requirements and ensure proper color contrast ratios."}

- Brief: "fix login bug"
  Response: {"title": "Fix authentication error on login", "description": "Investigate and resolve the bug causing users to receive authentication errors during login. Check the JWT token validation, ensure proper error handling in the auth middleware, and verify the connection to the authentication service. Test with multiple user accounts to ensure the fix works universally."}`;

        try {
            const response = await ClaudeAI.invoke(prompt, true);

            // Extract JSON from response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }

            const { result } = JSON.parse(jsonMatch[0]);
            const expansion = JSON.parse(result.replace('```json', '').replace('```', ''));
            return expansion as TaskExpansion;
        } catch (error) {
            console.error('Failed to expand task with Claude:', error);
            return null;
        }
    }

    async generateCommitMessage(taskTitle: string, taskDescription: string, recentCommits: string[], summaries: string[]): Promise<string | null> {
        try {
            let prompt = `You are a git commit message generator. Generate a concise, clear commit message for the following task completion.
    
    Task Title: ${taskTitle}
    Task Description: ${taskDescription}
    
    `;

            if (recentCommits.length > 0) {
                prompt += `Recent commit messages for context (to match style):
    ${recentCommits.map((msg, i) => `${i + 1}. ${msg}`).join('\n')}
    
    `;
            }

            if (summaries.length > 0) {
                prompt += `Work completed across iterations:
    ${summaries.join('\n')}
    
    `;
            }

            prompt += `Generate a commit message that:
    1. Follows conventional commit format if the recent commits do (feat:, fix:, chore:, etc.)
    2. Is concise but descriptive (under 72 characters for the first line)
    3. Captures the essence of what was accomplished
    4. Matches the style/tone of recent commits
    
    Return ONLY the commit message text, nothing else.`;

            const response = await ClaudeAI.invoke(prompt);

            if (!response) {
                return null;
            }

            // Clean up the response to get just the commit message
            const lines = response.split('\n').filter((line: string) => line.trim() !== '');
            return lines[0] || null;

        } catch (error) {
            return null;
        }
    };

    async resolveMergeConflicts(filePath: string, diffContext: string, conflictedContent: string) {
        try {
            const prompt = `You are an expert software engineer tasked with resolving Git merge conflicts. 
            
            Analyze the following conflicted file and resolve the merge conflicts by choosing the best combination of changes from both sides or creating a solution that integrates both changes appropriately.

            File: ${filePath}

            Recent commit history for context:
            ${diffContext}

            Conflicted file content:
            \`\`\`
            ${conflictedContent}
            \`\`\`

            Please provide the resolved file content with:
            1. All conflict markers (<<<<<<< HEAD, =======, >>>>>>> branch) removed
            2. The best combination of changes from both sides
            3. Proper code formatting and syntax
            4. Logical integration of conflicting changes when possible

            Respond with ONLY the resolved file content, no explanations or markdown formatting.`;

            const response = await ClaudeAI.invoke(prompt);

            return response;
        } catch (err) {
            return null;
        }
    }
}