/**
 * Base class for ACP-based CLI agents.
 *
 * Consolidates all AI operations (task expansion, commit message generation,
 * merge conflict resolution, etc.) into a single implementation backed by
 * the ACPProvider from the agent package.
 *
 * Subclasses only need to provide:
 * - AGENT_BIN: the binary name for checkAgent()
 * - AGENT_NAME: the ACP agent identifier
 * - getContainerMounts(): Docker mount configuration
 * - getEnvironmentVariables(): Docker environment variables
 */

import { launch } from 'rover-core';
import type { WorkflowInput } from 'rover-schemas';
import { ACPProvider, type IPromptTask } from '@endorhq/agent';

export abstract class ACPAgentBase {
  abstract readonly AGENT_BIN: string;
  abstract readonly AGENT_NAME: string;

  private _provider?: ACPProvider;

  private get provider(): ACPProvider {
    if (!this._provider) {
      this._provider = new ACPProvider({ agentName: this.AGENT_NAME });
    }
    return this._provider;
  }

  async checkAgent(): Promise<void> {
    try {
      await launch(this.AGENT_BIN, ['--version']);
    } catch (_err) {
      throw new Error(
        `The agent "${this.AGENT_BIN}" is missing in the system or it's not properly configured.`
      );
    }
  }

  async invoke(
    prompt: string,
    options: { json?: boolean; cwd?: string; model?: string } = {}
  ): Promise<string> {
    try {
      return await this.provider.invoke(prompt, options);
    } catch (error) {
      throw new Error(`Failed to invoke "${this.AGENT_BIN}" due to: ${error}`);
    }
  }

  async expandTask(
    briefDescription: string,
    projectPath: string,
    contextContent?: string
  ): Promise<IPromptTask | null> {
    return this.provider.expandTask(
      briefDescription,
      projectPath,
      contextContent
    );
  }

  async expandIterationInstructions(
    instructions: string,
    previousPlan?: string,
    previousChanges?: string,
    contextContent?: string
  ): Promise<IPromptTask | null> {
    return this.provider.expandIterationInstructions(
      instructions,
      previousPlan,
      previousChanges,
      contextContent
    );
  }

  async generateCommitMessage(
    taskTitle: string,
    taskDescription: string,
    recentCommits: string[],
    summaries: string[]
  ): Promise<string | null> {
    return this.provider.generateCommitMessage(
      taskTitle,
      taskDescription,
      recentCommits,
      summaries
    );
  }

  async resolveMergeConflicts(
    filePath: string,
    diffContext: string,
    conflictedContent: string
  ): Promise<string | null> {
    return this.provider.resolveMergeConflicts(
      filePath,
      diffContext,
      conflictedContent
    );
  }

  async extractGithubInputs(
    issueDescription: string,
    inputs: WorkflowInput[]
  ): Promise<Record<string, any> | null> {
    return this.provider.extractGithubInputs(issueDescription, inputs);
  }

  abstract getContainerMounts(): string[];
  abstract getEnvironmentVariables(): string[];
}
