import { launch, launchSync } from 'rover-core';
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
import type { WorkflowInput } from 'rover-schemas';

// Environment variables reference:
// - https://raw.githubusercontent.com/QwenLM/qwen-code/refs/heads/main/docs/cli/configuration.md
const QWEN_ENV_VARS = [
  // Sandbox and debugging
  'GEMINI_SANDBOX',
  'SEATBELT_PROFILE',
  'DEBUG',
  'DEBUG_MODE',
  'BUILD_SANDBOX',

  // General configuration
  'NO_COLOR',
  'CLI_TITLE',
  'CODE_ASSIST_ENDPOINT',

  // Web search configuration
  'TAVILY_API_KEY',
];

class QwenAI implements AIAgentTool {
  // constants
  public AGENT_BIN = 'qwen';
  private promptBuilder = new PromptBuilder('qwen');

  async checkAgent(): Promise<void> {
    try {
      await launch(this.AGENT_BIN, ['--version']);
    } catch (_err) {
      throw new MissingAIAgentError(this.AGENT_BIN);
    }
  }

  async invoke(prompt: string, json: boolean = false): Promise<string> {
    const qwenArgs = ['-p'];

    if (json) {
      // Qwen does not have any way to force the JSON output at CLI level.
      // Trying to force it via prompting
      prompt = `${prompt}

You MUST output a valid JSON string as an output. Just output the JSON string and nothing else. If you had any error, still return a JSON string with an "error" property.`;
    }

    try {
      const { stdout } = await launch(this.AGENT_BIN, qwenArgs, {
        input: prompt,
      });
      return stdout?.toString().trim() || '';
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
      console.error('Failed to expand task with Qwen:', error);
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
        'Failed to expand iteration instructions with Qwen:',
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

  async extractGithubInputs(
    issueDescription: string,
    inputs: WorkflowInput[]
  ): Promise<Record<string, any> | null> {
    const prompt = this.promptBuilder.extractGithubInputsPrompt(
      issueDescription,
      inputs
    );

    try {
      const response = await this.invoke(prompt, true);
      return parseJsonResponse<Record<string, any>>(response);
    } catch (error) {
      console.error('Failed to extract GitHub inputs with Qwen:', error);
      return null;
    }
  }

  getContainerMounts(): string[] {
    const dockerMounts: string[] = [];
    const qwenFolder = join(homedir(), '.qwen');

    // Only mount if the folder exists
    if (existsSync(qwenFolder)) {
      dockerMounts.push(`-v`, `${qwenFolder}:/.qwen:Z,ro`);
    }

    return dockerMounts;
  }

  getEnvironmentVariables(): string[] {
    const envVars: string[] = [];

    // Look for any QWEN_* and OPENAI_* env vars
    for (const key in process.env) {
      if (key.startsWith('QWEN_') || key.startsWith('OPENAI_')) {
        envVars.push('-e', key);
      }
    }

    // Add other specific environment variables from QWEN_ENV_VARS
    for (const key of QWEN_ENV_VARS) {
      if (process.env[key] !== undefined) {
        envVars.push('-e', key);
      }
    }

    return envVars;
  }
}

export default QwenAI;
