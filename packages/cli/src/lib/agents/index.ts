import ClaudeAI from './claude.js';
import CodexAI from './codex.js';
import CursorAI from './cursor.js';
import GeminiAI from './gemini.js';
import QwenAI from './qwen.js';
import type { IPromptTask } from '../prompts/index.js';
import { UserSettings } from '../config.js';
import { AI_AGENT, launchSync } from 'rover-common';
import type { WorkflowInput } from 'rover-schemas';

export const findKeychainCredentials = (key: string): string => {
  const result = launchSync(
    'security',
    ['find-generic-password', '-s', key, '-w'],
    { mightLogSensitiveInformation: true }
  );
  return result.stdout?.toString() || '';
};

export interface AIAgentTool {
  // Invoke the CLI tool using the SDK / direct mode with the given prompt
  invoke(prompt: string, json: boolean): Promise<string>;

  // Check if the current AI agent is available
  // It will throw an exception in other case
  checkAgent(): Promise<void>;

  // Expand a brief task description into a full task with title and description
  expandTask(
    briefDescription: string,
    projectPath: string
  ): Promise<IPromptTask | null>;

  // Expand iteration instructions based on previous work
  expandIterationInstructions(
    instructions: string,
    previousPlan?: string,
    previousChanges?: string
  ): Promise<IPromptTask | null>;

  // Generate a git commit message based on the task and recent commits
  generateCommitMessage(
    taskTitle: string,
    taskDescription: string,
    recentCommits: string[],
    summaries: string[]
  ): Promise<string | null>;

  // Resolve merge conflicts automatically
  resolveMergeConflicts(
    filePath: string,
    diffContext: string,
    conflictedContent: string
  ): Promise<string | null>;

  // Extract workflow input values from a GitHub issue description
  extractGithubInputs(
    issueDescription: string,
    inputs: WorkflowInput[]
  ): Promise<Record<string, any> | null>;

  // Get Docker mount strings for agent-specific credential files
  getContainerMounts(): string[];

  // Get Container environment variables for this tool
  getEnvironmentVariables(): string[];
}

export class MissingAIAgentError extends Error {
  constructor(agent: string) {
    super(
      `The agent "${agent}" is missing in the system or it's not properly configured.`
    );
    this.name = 'MissingAIAgentError';
  }
}

export class AIAgentConfigError extends Error {
  constructor() {
    super('Could not load user settings');
    this.name = 'AIAgentConfigError';
  }
}

export class InvokeAIAgentError extends Error {
  constructor(agent: string, error: unknown) {
    super(`Failed to invoke "${agent}" due to: ${error}`);
    this.name = 'InvokeAIAgentError';
  }
}

/**
 * Retrieve the AIAgentTool instance based on the agent name.
 */
export const getAIAgentTool = (agent: string): AIAgentTool => {
  switch (agent.toLowerCase()) {
    case 'claude':
      return new ClaudeAI();
    case 'codex':
      return new CodexAI();
    case 'cursor':
      return new CursorAI();
    case 'gemini':
      return new GeminiAI();
    case 'qwen':
      return new QwenAI();
    default:
      throw new Error(`Unknown AI agent: ${agent}`);
  }
};

/**
 * Load the user configuration and return the given AI agent
 * or Claude by default.
 */
export const getUserAIAgent = (): AI_AGENT => {
  try {
    if (UserSettings.exists()) {
      const userSettings = UserSettings.load();
      return userSettings.defaultAiAgent || AI_AGENT.Claude;
    } else {
      return AI_AGENT.Claude;
    }
  } catch (error) {
    throw new AIAgentConfigError();
  }
};
