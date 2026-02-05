import { launch } from 'rover-core';
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

// Environment variables reference for OpenCode:
// - https://opencode.ai/docs/providers/#environment-variables-quick-start
const OPENCODE_ENV_VARS = [
  // General configuration
  'NO_COLOR',
  'DEBUG',

  // AWS/Amazon Bedrock
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_PROFILE',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_ROLE_ARN',
  'AWS_REGION',

  // Azure
  'AZURE_RESOURCE_NAME',
  'AZURE_COGNITIVE_SERVICES_RESOURCE_NAME',

  // Cloudflare
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_GATEWAY_ID',
  'CLOUDFLARE_API_TOKEN',

  // Google Cloud/Vertex AI
  'GOOGLE_CLOUD_PROJECT',
  'VERTEX_LOCATION',
  'GOOGLE_APPLICATION_CREDENTIALS',

  // GitLab
  'GITLAB_TOKEN',
  'GITLAB_INSTANCE_URL',
  'GITLAB_AI_GATEWAY_URL',
  'GITLAB_OAUTH_CLIENT_ID',

  // SAP AI Core
  'AICORE_SERVICE_KEY',
  'AICORE_DEPLOYMENT_ID',
  'AICORE_RESOURCE_GROUP',
];

class OpenCodeAI implements AIAgentTool {
  // constants
  public AGENT_BIN = 'opencode';
  private promptBuilder = new PromptBuilder('opencode');

  async checkAgent(): Promise<void> {
    try {
      await launch(this.AGENT_BIN, ['--version']);
    } catch (_err) {
      throw new MissingAIAgentError(this.AGENT_BIN);
    }
  }

  async invoke(
    prompt: string,
    json: boolean = false,
    cwd?: string
  ): Promise<string> {
    // OpenCode uses: echo "prompt" | opencode run [--format json]
    // See: https://opencode.ai/docs/cli/
    if (json) {
      prompt = `${prompt}

You MUST output a valid JSON string as an output. Just output the JSON string and nothing else. If you had any error, still return a JSON string with an "error" property.`;
    }

    // Build arguments: run [--format json]
    const opencodeArgs = ['run'];

    if (json) {
      opencodeArgs.push('--format', 'json');
    }

    try {
      const { stdout } = await launch(this.AGENT_BIN, opencodeArgs, {
        input: prompt,
        cwd,
        env: process.env,
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
    projectPath: string,
    contextContent?: string
  ): Promise<IPromptTask | null> {
    const prompt = this.promptBuilder.expandTaskPrompt(
      briefDescription,
      contextContent
    );

    try {
      const response = await this.invoke(prompt, true, projectPath);
      return parseJsonResponse<IPromptTask>(response);
    } catch (error) {
      console.error('Failed to expand task with OpenCode:', error);
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
      const response = await this.invoke(prompt, true);
      return parseJsonResponse<IPromptTask>(response);
    } catch (error) {
      console.error(
        'Failed to expand iteration instructions with OpenCode:',
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
      console.error('Failed to extract GitHub inputs with OpenCode:', error);
      return null;
    }
  }

  getContainerMounts(): string[] {
    const dockerMounts: string[] = [];

    // OpenCode stores config in ~/.config/opencode/ directory
    // See: https://opencode.ai/docs/providers/#config
    const opencodeConfigFolder = join(homedir(), '.config', 'opencode');
    if (existsSync(opencodeConfigFolder)) {
      dockerMounts.push(`-v`, `${opencodeConfigFolder}:/.config/opencode:Z,ro`);
    }

    // OpenCode stores credentials in ~/.local/share/opencode/auth.json
    // See: https://opencode.ai/docs/providers/#credentials
    const opencodeDataFolder = join(homedir(), '.local', 'share', 'opencode');
    if (existsSync(opencodeDataFolder)) {
      dockerMounts.push(
        `-v`,
        `${opencodeDataFolder}:/.local/share/opencode:Z,ro`
      );
    }

    return dockerMounts;
  }

  getEnvironmentVariables(): string[] {
    const envVars: string[] = [];
    const addedKeys = new Set<string>();

    // Common provider prefixes
    const providerPrefixes = [
      'OPENCODE_',
      'ANTHROPIC_',
      'OPENAI_',
      'AZURE_',
      'AWS_',
      'GOOGLE_',
      'VERTEX_',
      'GITLAB_',
      'CLOUDFLARE_',
      'AICORE_',
    ];

    // Look for any provider-prefixed env vars
    for (const key in process.env) {
      if (providerPrefixes.some(prefix => key.startsWith(prefix))) {
        if (!addedKeys.has(key)) {
          envVars.push('-e', key);
          addedKeys.add(key);
        }
      }
    }

    // Add other specific environment variables from OPENCODE_ENV_VARS
    for (const key of OPENCODE_ENV_VARS) {
      if (process.env[key] !== undefined && !addedKeys.has(key)) {
        envVars.push('-e', key);
        addedKeys.add(key);
      }
    }

    return envVars;
  }
}

export default OpenCodeAI;
