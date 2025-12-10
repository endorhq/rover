import { launch, launchSync } from 'rover-core';
import {
  AIAgentTool,
  findKeychainCredentials,
  InvokeAIAgentError,
  MissingAIAgentError,
} from './index.js';
import { PromptBuilder, IPromptTask } from '../prompts/index.js';
import { parseJsonResponse } from '../../utils/json-parser.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { fileSync } from 'tmp';
import type { WorkflowInput } from 'rover-schemas';

// Environment variables reference:
// - https://cursor.com/docs/cli/reference/parameters
const CURSOR_ENV_VARS = [
  // API key
  'CURSOR_API_KEY',
];

// macOS Keychain items for Cursor
const CURSOR_KEYCHAIN_ITEMS = ['cursor-access-token', 'cursor-refresh-token'];

class CursorAI implements AIAgentTool {
  // constants
  public AGENT_BIN = 'cursor-agent';
  private promptBuilder = new PromptBuilder('cursor');

  async checkAgent(): Promise<void> {
    try {
      await launch(this.AGENT_BIN, ['--version']);
    } catch (_err) {
      throw new MissingAIAgentError(this.AGENT_BIN);
    }
  }

  async invoke(prompt: string, json: boolean = false): Promise<string> {
    const cursorArgs = ['agent', '--print'];
    if (json) {
      cursorArgs.push('--output-format');
      cursorArgs.push('json');

      prompt = `${prompt}

You MUST output a valid JSON string as an output. Just output the JSON string and nothing else. If you had any error, still return a JSON string with an "error" property.`;
    }

    try {
      const { stdout } = await launch(this.AGENT_BIN, cursorArgs, {
        input: prompt,
      });

      const result = stdout?.toString().trim() || '';

      if (json) {
        try {
          const parsed = JSON.parse(result);
          return `${parsed.result}`;
        } catch (_err) {
          throw new InvokeAIAgentError(this.AGENT_BIN, 'Invalid JSON output');
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
      console.error('Failed to expand task with Cursor:', error);
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
        'Failed to expand iteration instructions with Cursor:',
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
      console.error('Failed to extract GitHub inputs with Cursor:', error);
      return null;
    }
  }

  getContainerMounts(): string[] {
    const dockerMounts: string[] = [];

    const cursorDirectory = join(homedir(), '.cursor');
    if (existsSync(cursorDirectory)) {
      dockerMounts.push(`-v`, `${cursorDirectory}:/.cursor:Z,ro`);
    }

    const cursorAuthDirectory = join(homedir(), '.config', 'cursor');
    if (existsSync(cursorAuthDirectory)) {
      dockerMounts.push(`-v`, `${cursorAuthDirectory}:/.config/cursor:Z,ro`);
    } else if (platform() === 'darwin') {
      // On macOS, if .cursor directory doesn't exist but keychain has credentials,
      // create a temporary directory with credentials from keychain
      const accessToken = findKeychainCredentials('cursor-access-token');
      const refreshToken = findKeychainCredentials('cursor-refresh-token');

      if (accessToken || refreshToken) {
        const tmpDir = fileSync({
          mode: 0o600,
          prefix: 'cursor-',
          postfix: '',
        });
        const config: any = {};

        if (accessToken) {
          config.accessToken = accessToken;
        }
        if (refreshToken) {
          config.refreshToken = refreshToken;
        }

        // Write the config file
        const configPath = tmpDir.name;
        writeFileSync(configPath, JSON.stringify(config));

        // Mount the temporary config file
        dockerMounts.push(`-v`, `${configPath}:/.config/cursor/auth.json:Z,ro`);
      }
    }

    return dockerMounts;
  }

  getEnvironmentVariables(): string[] {
    const envVars: string[] = [];

    // Add standard environment variables
    for (const key of CURSOR_ENV_VARS) {
      if (process.env[key] !== undefined) {
        envVars.push('-e', key);
      }
    }

    // On macOS, extract credentials from Keychain and make them available
    if (platform() === 'darwin') {
      for (const keychainItem of CURSOR_KEYCHAIN_ITEMS) {
        const value = findKeychainCredentials(keychainItem);
        if (value) {
          // Convert keychain item name to environment variable name
          // e.g., cursor-access-token -> CURSOR_ACCESS_TOKEN
          const envVarName = keychainItem.toUpperCase().replace(/-/g, '_');
          envVars.push('-e', `${envVarName}=${value}`);
        }
      }
    }

    return envVars;
  }
}

export default CursorAI;
