import ClaudeAI from './claude.js';
import GeminiAI from './gemini.js';
import type { IPromptTask } from '../prompts/index.js';

export interface AIAgentTool {
  // Invoke the CLI tool using the SDK / direct mode with the given prompt
  invoke(prompt: string, json: boolean): Promise<string>;

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
}

export class MissingAIAgentError extends Error {
  constructor(agent: string) {
    super(
      `The agent "${agent}" is missing in the system or it's not properly configured.`
    );
    this.name = 'MissingAIAgentError';
  }
}

export class InvokeAIAgentError extends Error {
  constructor(agent: string, error: unknown) {
    super(`Failed to invoke "${agent}" due to: ${error}`);
    this.name = 'InvokeAIAgentError';
  }
}

export function getAIAgentTool(agent: string): AIAgentTool {
  switch (agent.toLowerCase()) {
    case 'claude':
      return new ClaudeAI();
    case 'gemini':
      return new GeminiAI();
    default:
      throw new Error(`Unknown AI agent: ${agent}`);
  }
}
