import { launch, launchSync } from 'rover-common';
import {
  AIAgentTool,
  InvokeAIAgentError,
  MissingAIAgentError,
} from './index.js';
import { PromptBuilder, IPromptTask } from '../prompts/index.js';
import { parseJsonResponse } from '../../utils/json-parser.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Environment variables reference:
// - Run `copilot help environment` for official environment variables documentation
const COPILOT_ENV_VARS = [
  // GitHub Copilot CLI configuration
  'COPILOT_ALLOW_ALL',
  'COPILOT_CUSTOM_INSTRUCTIONS_DIRS',
  'COPILOT_MODEL',
  
  // GitHub authentication
  'GH_TOKEN',
  'GITHUB_TOKEN',
  
  // General configuration
  'XDG_CONFIG_HOME',
  'XDG_STATE_HOME',
  'NO_COLOR',
  'CLICOLOR',
  'CLICOLOR_FORCE',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'DEBUG',
];

class CopilotAI implements AIAgentTool {
  // constants
  public AGENT_BIN = 'copilot';
  private promptBuilder = new PromptBuilder('copilot');

  constructor() {
    // Check standalone Copilot CLI is available
    try {
      launchSync(this.AGENT_BIN, ['--version']);
    } catch (err) {
      throw new MissingAIAgentError(this.AGENT_BIN);
    }
  }

  async invoke(prompt: string, json: boolean = false): Promise<string> {
    let finalPrompt = prompt;
    
        if (json) {
          // GitHub Copilot CLI is conversational and doesn't support structured JSON output.
          // We need to be very explicit about JSON-only responses
          finalPrompt = `${prompt}

CRITICAL: You MUST respond with ONLY a valid JSON object. No conversational text, no explanations, no markdown, no bullet points, no greetings. Nothing else.

Example of correct response format:
{"title": "Example title", "description": "Example description"}`;
        }

    // Use standalone copilot with -p flag for non-interactive mode
    const copilotArgs = ['-p', finalPrompt, '--allow-all-paths', '--allow-all-tools'];

    try {
      const { stdout } = await launch(this.AGENT_BIN, copilotArgs);

          const result = stdout?.toString().trim() || '';

          if (json) {
            try {
              // Clean the response to extract JSON from various formats
              let cleanedResult = result;
              
              // Remove bullet points and other formatting characters from the start
              cleanedResult = cleanedResult.replace(/^[●•*\-+]\s*/, '');
              
              // Remove common conversational prefixes
              cleanedResult = cleanedResult.replace(/^(I understand|Here's|Here is|The JSON|Response:|Answer:)\s*/i, '');
              
              // Find JSON object in markdown code blocks (```json ... ```)
              const jsonCodeBlockMatch = cleanedResult.match(/```json\s*([\s\S]*?)\s*```/);
              if (jsonCodeBlockMatch) {
                cleanedResult = jsonCodeBlockMatch[1].trim();
              } else {
                // Look for JSON object directly - find the first { and last }
                const firstBrace = cleanedResult.indexOf('{');
                const lastBrace = cleanedResult.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                  cleanedResult = cleanedResult.substring(firstBrace, lastBrace + 1);
                }
              }
              
              // Clean up whitespace and fix JSON formatting issues
              cleanedResult = cleanedResult.trim();
              
              // Fix common JSON formatting issues from Copilot's multiline responses
              // First, handle newlines within JSON strings properly
              // We need to be careful to only escape newlines that are inside string values
              cleanedResult = cleanedResult.replace(/\n\s*/g, '\\n');
              
              // Remove any remaining control characters that could break JSON parsing
              // Keep only printable ASCII characters and essential JSON characters
              cleanedResult = cleanedResult.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
              
              // Additional cleanup for common formatting issues
              cleanedResult = cleanedResult.replace(/\s+/g, ' '); // Normalize whitespace
              
              const parsed = JSON.parse(cleanedResult);
              return JSON.stringify(parsed);
            } catch (jsonErr) {
              // If JSON parsing fails, log the issue and return the raw result for parseJsonResponse to handle
              console.error('Copilot JSON parsing failed:', jsonErr.message);
              console.error('Cleaned result that failed to parse:', JSON.stringify(cleanedResult));
              return result;
            }
          } else {
            return result;
          }
    } catch (error) {
      throw new InvokeAIAgentError(this.AGENT_BIN, error);
    }
  }

  async expandTask(
    briefDescription: string,
    projectPath: string
  ): Promise<IPromptTask | null> {
    const prompt = this.promptBuilder.expandTaskPrompt(briefDescription);

    try {
      const response = await this.invoke(prompt, true);
      return parseJsonResponse<IPromptTask>(response);
    } catch (error) {
      console.error('Failed to expand task with Copilot:', error);
      return null;
    }
  }

  async expandIterationInstructions(
    instructions: string,
    previousPlan?: string,
    previousChanges?: string
  ): Promise<IPromptTask | null> {
    const prompt = this.promptBuilder.expandIterationInstructionsPrompt(
      instructions,
      previousPlan,
      previousChanges
    );

    try {
      const response = await this.invoke(prompt, true);
      return parseJsonResponse<IPromptTask>(response);
    } catch (error) {
      console.error(
        'Failed to expand iteration instructions with Copilot:',
        error
      );
      return null;
    }
  }

  async generateCommitMessage(
    taskTitle: string,
    taskDescription: string,
    recentCommits: string[],
    summaries: string[]
  ): Promise<string | null> {
    try {
      const prompt = this.promptBuilder.generateCommitMessagePrompt(
        taskTitle,
        taskDescription,
        recentCommits,
        summaries
      );
      const response = await this.invoke(prompt, false);

      if (!response) {
        return null;
      }

      // Clean up the response to get just the commit message
      const lines = response
        .split('\n')
        .filter((line: string) => line.trim() !== '');
      return lines[0] || null;
    } catch (error) {
      return null;
    }
  }

  async resolveMergeConflicts(
    filePath: string,
    diffContext: string,
    conflictedContent: string
  ): Promise<string | null> {
    try {
      const prompt = this.promptBuilder.resolveMergeConflictsPrompt(
        filePath,
        diffContext,
        conflictedContent
      );
      const response = await this.invoke(prompt, false);

      return response;
    } catch (err) {
      return null;
    }
  }

  getContainerMounts(): string[] {
    const dockerMounts: string[] = [];
    const ghConfigDir = join(homedir(), '.config', 'gh');

    // Mount GitHub CLI config directory if it exists
    if (existsSync(ghConfigDir)) {
      dockerMounts.push(`-v`, `${ghConfigDir}:/.config/gh:Z,ro`);
    }

    return dockerMounts;
  }

  getEnvironmentVariables(): string[] {
    const envVars: string[] = [];

    // Look for any COPILOT_* env vars
    for (const key in process.env) {
      if (key.startsWith('COPILOT_')) {
        envVars.push('-e', key);
      }
    }

    // Add other specific environment variables from COPILOT_ENV_VARS
    for (const key of COPILOT_ENV_VARS) {
      if (process.env[key] !== undefined) {
        envVars.push('-e', key);
      }
    }

    return envVars;
  }
}

export default CopilotAI;
