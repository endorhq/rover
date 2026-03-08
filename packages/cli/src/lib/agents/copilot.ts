import { launch } from 'rover-core';
import {
  AIAgentTool,
  InvokeAIAgentError,
  MissingAIAgentError,
  type InvokeOptions,
} from './index.js';
import { PromptBuilder, IPromptTask } from '../prompts/index.js';
import { parseJsonResponse } from '../../utils/json-parser.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { WorkflowInput } from 'rover-schemas';

// Environment variables for GitHub Copilot CLI
const COPILOT_ENV_VARS = ['GITHUB_TOKEN', 'GH_TOKEN'];

class CopilotAI implements AIAgentTool {
  public AGENT_BIN = 'copilot';
  private promptBuilder = new PromptBuilder('copilot');
  private model?: string;

  constructor(model?: string) {
    this.model = model;
  }

  async checkAgent(): Promise<void> {
    try {
      await launch(this.AGENT_BIN, ['--version']);
    } catch (_err) {
      throw new MissingAIAgentError(this.AGENT_BIN);
    }
  }

  async invoke(prompt: string, options: InvokeOptions = {}): Promise<string> {
    const { json = false, cwd, model } = options;

    if (json) {
      prompt = `${prompt}

You MUST output a valid JSON string as an output. Just output the JSON string and nothing else. If you had any error, still return a JSON string with an "error" property.`;
    }

    // Use -s (silent) to get clean output without stats
    const copilotArgs = ['-s', '-p', prompt];

    if (model) {
      copilotArgs.push('--model', model);
    }

    try {
      const { stdout } = await launch(this.AGENT_BIN, copilotArgs, {
        cwd,
      });

      // Copilot does not have a --output-format json flag like Claude/Cursor,
      // so we just return the raw result and let parseJsonResponse handle it
      return stdout?.toString().trim() || '';
    } catch (error) {
      throw new InvokeAIAgentError(this.AGENT_BIN, error);
    }
  }

  async expandTask(
    briefDescription: string,
    projectPath: string,
    contextContent?: string
  ): Promise<IPromptTask | null> {
    const prompt = this.promptBuilder.expandTaskPrompt(
      briefDescription,
      contextContent
    );

    try {
      const response = await this.invoke(prompt, {
        json: true,
        cwd: projectPath,
        model: this.model,
      });
      return parseJsonResponse<IPromptTask>(response);
    } catch (error) {
      console.error('Failed to expand task with Copilot:', error);
      return null;
    }
  }

  async expandIterationInstructions(
    instructions: string,
    previousPlan?: string,
    previousChanges?: string,
    contextContent?: string
  ): Promise<IPromptTask | null> {
    const prompt = this.promptBuilder.expandIterationInstructionsPrompt(
      instructions,
      previousPlan,
      previousChanges,
      contextContent
    );

    try {
      const response = await this.invoke(prompt, {
        json: true,
        model: this.model,
      });
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
      const response = await this.invoke(prompt, { model: this.model });

      if (!response) {
        return null;
      }

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
      const response = await this.invoke(prompt, { model: this.model });

      return response;
    } catch (err) {
      return null;
    }
  }

  async resolveMergeConflictsRegions(
    filePath: string,
    diffContext: string,
    conflictedContent: string,
    regionCount: number
  ): Promise<string | null> {
    try {
      const prompt = this.promptBuilder.resolveMergeConflictsRegionsPrompt(
        filePath,
        diffContext,
        conflictedContent,
        regionCount
      );
      const response = await this.invoke(prompt, {
        model: this.model,
      });

      return response;
    } catch (err) {
      throw err;
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
      const response = await this.invoke(prompt, {
        json: true,
        model: this.model,
      });
      return parseJsonResponse<Record<string, any>>(response);
    } catch (error) {
      console.error('Failed to extract GitHub inputs with Copilot:', error);
      return null;
    }
  }

  getContainerMounts(): string[] {
    const dockerMounts: string[] = [];
    const copilotDir = join(homedir(), '.copilot');

    if (existsSync(copilotDir)) {
      dockerMounts.push(`-v`, `${copilotDir}:/.copilot:Z,ro`);
    }

    return dockerMounts;
  }

  getEnvironmentVariables(): string[] {
    const envVars: string[] = [];
    const addedKeys = new Set<string>();

    // Look for COPILOT_* and GITHUB_* env vars
    for (const key in process.env) {
      if (key.startsWith('COPILOT_') || key.startsWith('GITHUB_')) {
        addedKeys.add(key);
        envVars.push('-e', key);
      }
    }

    // Add other specific environment variables
    for (const key of COPILOT_ENV_VARS) {
      if (process.env[key] !== undefined && !addedKeys.has(key)) {
        envVars.push('-e', key);
      }
    }

    return envVars;
  }
}

export default CopilotAI;
