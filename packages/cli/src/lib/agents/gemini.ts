import { spawn, spawnSync } from "../os.js";
import { AIAgentTool, InvokeAIAgentError, MissingAIAgentError } from "./index.js";
import { PromptBuilder, IPromptTask } from "../prompt.js";
import { parseJsonResponse } from "../../utils/json-parser.js";

class GeminiAI implements AIAgentTool {
    // constants
    public AGENT_BIN = 'gemini';
    private promptBuilder = new PromptBuilder('gemini');

    constructor() {
        // Check docker is available
        try {
            spawnSync(this.AGENT_BIN, ['--version'], { stdio: 'pipe' })
        } catch (err) {
            throw new MissingAIAgentError(this.AGENT_BIN);
        }
    }

    async invoke(prompt: string, json: boolean = false): Promise<string> {
        const geminiArgs = ['-p'];

        if (json) {
            // Gemini does not have any way to force the JSON output at CLI level.
            // Trying to force it via prompting
            prompt = `${prompt}

You MUST output a valid JSON string as an output. Just output the JSON string and nothing else. If you had any error, still return a JSON string with an "error" property.`;
        }

        try {
            const { stdout } = await spawn(this.AGENT_BIN, geminiArgs, {
                input: prompt,
            });
            return stdout?.toString().trim() || '';
        } catch (error) {
            throw new InvokeAIAgentError(this.AGENT_BIN, error);
        }
    }

    async expandTask(briefDescription: string, projectPath: string): Promise<IPromptTask | null> {
        const prompt = this.promptBuilder.expandTaskPrompt(briefDescription);

        try {
            const response = await this.invoke(prompt, true);
            return parseJsonResponse<IPromptTask>(response);
        } catch (error) {
            console.error('Failed to expand task with Gemini:', error);
            return null;
        }
    }

    async expandIterationInstructions(instructions: string, previousPlan?: string, previousChanges?: string): Promise<IPromptTask | null> {
        const prompt = this.promptBuilder.expandIterationInstructionsPrompt(instructions, previousPlan, previousChanges);

        try {
            const response = await this.invoke(prompt, true);
            return parseJsonResponse<IPromptTask>(response);
        } catch (error) {
            console.error('Failed to expand iteration instructions with Gemini:', error);
            return null;
        }
    }

    async generateCommitMessage(taskTitle: string, taskDescription: string, recentCommits: string[], summaries: string[]): Promise<string | null> {
        try {
            const prompt = this.promptBuilder.generateCommitMessagePrompt(taskTitle, taskDescription, recentCommits, summaries);
            const response = await this.invoke(prompt, false);

            if (!response) {
                return null;
            }

            // Clean up the response to get just the commit message
            const lines = response.split('\n').filter((line: string) => line.trim() !== '');
            return lines[0] || null;

        } catch (error) {
            return null;
        }
    }

    async resolveMergeConflicts(filePath: string, diffContext: string, conflictedContent: string): Promise<string | null> {
        try {
            const prompt = this.promptBuilder.resolveMergeConflictsPrompt(filePath, diffContext, conflictedContent);
            const response = await this.invoke(prompt, false);

            return response;
        } catch (err) {
            return null;
        }
    }
}

export default GeminiAI;