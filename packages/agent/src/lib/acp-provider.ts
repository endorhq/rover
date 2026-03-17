/**
 * ACPProvider: a high-level AI provider that communicates with agents via ACP.
 *
 * This class consolidates all prompt-based AI operations (task expansion,
 * commit message generation, merge conflict resolution, etc.) into a single
 * reusable provider that works with any ACP-compatible agent.
 *
 * Can be used directly by consumers of the agent package without going
 * through the CLI.
 */

import type { WorkflowInput } from 'rover-schemas';
import { acpInvoke } from './acp-invoke.js';
import { parseJsonResponse } from './json-parser.js';
import { PromptBuilder, type IPromptTask } from './prompts/index.js';

export interface ACPProviderConfig {
  /** Agent name (claude, codex, cursor, gemini, qwen, copilot, opencode). */
  agentName: string;
  /** Default model override. */
  model?: string;
}

export class ACPProvider {
  private agentName: string;
  private model?: string;
  private promptBuilder: PromptBuilder;

  constructor(config: ACPProviderConfig) {
    this.agentName = config.agentName;
    this.model = config.model;
    this.promptBuilder = new PromptBuilder(config.agentName);
  }

  /**
   * Send a prompt to the agent via ACP and return the response.
   */
  async invoke(
    prompt: string,
    options: { json?: boolean; cwd?: string; model?: string } = {}
  ): Promise<string> {
    const { json = false, cwd, model } = options;

    let finalPrompt = prompt;
    if (json) {
      finalPrompt = `${prompt}

You MUST output a valid JSON string as an output. Just output the JSON string and nothing else. If you had any error, still return a JSON string with an "error" property.`;
    }

    return acpInvoke({
      agentName: this.agentName,
      prompt: finalPrompt,
      cwd,
      model: model ?? this.model,
    });
  }

  /**
   * Expand a brief task description into a structured task with title and description.
   */
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
      });
      return parseJsonResponse<IPromptTask>(response);
    } catch (error) {
      console.error(`Failed to expand task with ${this.agentName}:`, error);
      return null;
    }
  }

  /**
   * Expand iteration instructions based on previous work context.
   */
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
      const response = await this.invoke(prompt, { json: true });
      return parseJsonResponse<IPromptTask>(response);
    } catch (error) {
      console.error(
        `Failed to expand iteration instructions with ${this.agentName}:`,
        error
      );
      return null;
    }
  }

  /**
   * Generate a git commit message based on the task and recent commits.
   */
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
      const response = await this.invoke(prompt);

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

  /**
   * Resolve merge conflicts automatically.
   */
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
      const response = await this.invoke(prompt);

      return response;
    } catch (err) {
      return null;
    }
  }

  /**
   * Extract workflow input values from a GitHub issue description.
   */
  async extractGithubInputs(
    issueDescription: string,
    inputs: WorkflowInput[]
  ): Promise<Record<string, any> | null> {
    const prompt = this.promptBuilder.extractGithubInputsPrompt(
      issueDescription,
      inputs
    );

    try {
      const response = await this.invoke(prompt, { json: true });
      return parseJsonResponse<Record<string, any>>(response);
    } catch (error) {
      console.error(
        `Failed to extract GitHub inputs with ${this.agentName}:`,
        error
      );
      return null;
    }
  }
}
