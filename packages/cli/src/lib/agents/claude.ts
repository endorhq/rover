import { launch, launchSync } from 'rover-common';
import {
  AIAgentTool,
  InvokeAIAgentError,
  MissingAIAgentError,
} from './index.js';
import { PromptBuilder, IPromptTask } from '../prompts/index.js';
import { parseJsonResponse } from '../../utils/json-parser.js';
import { homedir, tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';

const findKeychainCredentials = (key: string): string => {
  const result = launchSync(
    'security',
    ['find-generic-password', '-s', key, '-w'],
    { mightLogSensitiveInformation: true }
  );
  return result.stdout?.toString() || '';
};

class ClaudeAI implements AIAgentTool {
  // constants
  public AGENT_BIN = 'claude';
  private promptBuilder = new PromptBuilder('claude');

  constructor() {
    // Check Claude CLI is available
    try {
      launchSync(this.AGENT_BIN, ['--version']);
    } catch (err) {
      throw new MissingAIAgentError(this.AGENT_BIN);
    }
  }

  async invoke(prompt: string, json: boolean = false): Promise<string> {
    const claudeArgs = ['-p'];

    if (json) {
      claudeArgs.push('--output-format');
      claudeArgs.push('json');

      prompt = `${prompt}

You MUST output a valid JSON string as an output. Just output the JSON string and nothing else. If you had any error, still return a JSON string with an "error" property.`;
    }

    try {
      const { stdout } = await launch(this.AGENT_BIN, claudeArgs, {
        input: prompt,
        env: {
          ...process.env,
          // Ensure non-interactive mode
          CLAUDE_NON_INTERACTIVE: 'true',
        },
      });

      // Result
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
      console.error('Failed to expand task with Claude:', error);
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
        'Failed to expand iteration instructions with Claude:',
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
    const claudeFile = join(homedir(), '.claude.json');
    const claudeCreds = join(homedir(), '.claude', '.credentials.json');

    dockerMounts.push(`-v`, `${claudeFile}:/.claude.json:Z,ro`);

    if (existsSync(claudeCreds)) {
      dockerMounts.push(`-v`, `${claudeCreds}:/.credentials.json:Z,ro`);
    } else if (platform() === 'darwin') {
      const claudeCredsData = findKeychainCredentials(
        'Claude Code-credentials'
      );
      const userCredentialsTempPath = mkdtempSync(join(tmpdir(), 'rover-'));
      const claudeCredsFile = join(
        userCredentialsTempPath,
        '.credentials.json'
      );
      writeFileSync(claudeCredsFile, claudeCredsData);
      // Do not mount credentials as RO, as they will be
      // shredded by the setup script when it finishes
      dockerMounts.push(`-v`, `${claudeCredsFile}:/.credentials.json:Z`);
    }

    return dockerMounts;
  }
}

export default ClaudeAI;
