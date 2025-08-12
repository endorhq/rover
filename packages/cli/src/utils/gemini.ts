import { execa } from 'execa';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Environment, ProjectInstructions, TaskExpansion, AIProvider } from '../types.js';

export class GeminiAI implements AIProvider {
    private static async invoke(prompt: string, json: boolean = false): Promise<string> {
        const geminiArgs = ['-p'];

        try {
            const { stdout } = await execa('gemini', geminiArgs, {
                input: prompt,
                env: {
                    ...process.env,
                },
            });
            return stdout.trim();
        } catch (error) {
            throw new Error(`Failed to invoke Gemini: ${error}`);
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
            const response = await GeminiAI.invoke(prompt, true);
            // Gemini returns plain JSON without wrapper
            const parsed = response.replace('```json', '').replace('```', '');
            const expansion = JSON.parse(parsed);
            return expansion as TaskExpansion;
        } catch (error) {
            console.error('Failed to expand task with Gemini:', error);
            return null;
        }
    }

    async expandIterationInstructions(instructions: string, previousPlan?: string, previousChanges?: string): Promise<TaskExpansion | null> {
        let contextSection = '';

        if (previousPlan || previousChanges) {
            contextSection += `\nPrevious iteration context:\n`;

            if (previousPlan) {
                contextSection += `\nPrevious Plan:\n${previousPlan}\n`;
            }

            if (previousChanges) {
                contextSection += `\nPrevious Changes Made:\n${previousChanges}\n`;
            }
        }

        const prompt = `You are helping iterate on a software development task. Based on new user instructions and previous iteration context, create a focused title and detailed description for this specific iteration.

${contextSection}

New user instructions for this iteration:
${instructions}

Create a clear, action-oriented title and comprehensive description that:
1. Incorporates the new user instructions
2. Builds upon the previous work (if any)
3. Focuses on what needs to be accomplished in this specific iteration
4. Is specific and actionable

Respond ONLY with valid JSON in this exact format:
{
  "title": "Iteration-specific title focusing on the new requirements (max 12 words)",
  "description": "Detailed description that explains what needs to be done in this iteration, building on previous work. Include specific steps, requirements, and context from previous iterations. (3-5 sentences)"
}

Examples:
- Instructions: "add error handling to the login form"
  Previous: User login form was implemented
  Response: {"title": "Add comprehensive error handling to login form", "description": "Enhance the existing login form by implementing comprehensive error handling for various failure scenarios. Add validation for network errors, authentication failures, and form validation errors. Display user-friendly error messages and ensure proper error state management. This builds on the previously implemented basic login form functionality."}

- Instructions: "improve the performance of the search feature"
  Previous: Search functionality was added
  Response: {"title": "Optimize search performance and add caching", "description": "Improve the performance of the existing search feature by implementing result caching, debounced input handling, and optimized database queries. Add loading states and pagination to handle large result sets efficiently. This enhancement builds on the previously implemented basic search functionality to provide a better user experience."}`;

        try {
            const response = await GeminiAI.invoke(prompt, true);
            // Gemini returns plain JSON without wrapper
            const parsed = response.replace('```json', '').replace('```', '').trim();
            const expansion = JSON.parse(parsed);
            return expansion as TaskExpansion;
        } catch (error) {
            console.error('Failed to expand iteration instructions with Gemini:', error);
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

            const response = await GeminiAI.invoke(prompt);

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

            const response = await GeminiAI.invoke(prompt);

            return response;
        } catch (err) {
            return null;
        }
    }
}