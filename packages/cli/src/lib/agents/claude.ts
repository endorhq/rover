import {
  launch,
  launchSync,
  requiredClaudeCredentials,
  requiredBedrockCredentials,
  requiredVertexAiCredentials,
} from 'rover-common';
import {
  AIAgentTool,
  findKeychainCredentials,
  InvokeAIAgentError,
  MissingAIAgentError,
} from './index.js';
import { PromptBuilder, IPromptTask } from '../prompts/index.js';
import { parseJsonResponse } from '../../utils/json-parser.js';
import { homedir, tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { WorkflowInput } from 'rover-schemas';

// Environment variables reference:
// - https://docs.claude.com/en/docs/claude-code/settings.md
// - https://docs.claude.com/en/docs/claude-code/google-vertex-ai.md
// - https://docs.claude.com/en/docs/claude-code/amazon-bedrock.md
// - https://docs.claude.com/en/docs/claude-code/llm-gateway.md
const CLAUDE_CODE_ENV_VARS = [
  // AWS/Bedrock configuration
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'AWS_BEARER_TOKEN_BEDROCK',

  // Amazon Bedrock configuration
  'CLAUDE_CODE_USE_BEDROCK',
  'AWS_BEARER_TOKEN_BEDROCK',
  'ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'awsAuthRefresh',
  'awsCredentialExport',

  // Google Vertex AI configuration
  'CLAUDE_CODE_USE_VERTEX',
  'CLOUD_ML_REGION',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'VERTEX_REGION_CLAUDE_3_5_HAIKU',
  'VERTEX_REGION_CLAUDE_3_5_SONNET',
  'VERTEX_REGION_CLAUDE_3_7_SONNET',
  'VERTEX_REGION_CLAUDE_4_0_OPUS',
  'VERTEX_REGION_CLAUDE_4_0_SONNET',
  'VERTEX_REGION_CLAUDE_4_1_OPUS',

  // General configuration
  'ANTHROPIC_SMALL_FAST_MODEL',
  'BASH_DEFAULT_TIMEOUT_MS',
  'BASH_MAX_OUTPUT_LENGTH',
  'BASH_MAX_TIMEOUT_MS',
  'CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR',
  'DISABLE_AUTOUPDATER',
  'DISABLE_BUG_COMMAND',
  'DISABLE_COST_WARNINGS',
  'DISABLE_ERROR_REPORTING',
  'DISABLE_NON_ESSENTIAL_MODEL_CALLS',
  'DISABLE_PROMPT_CACHING',
  'DISABLE_TELEMETRY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'MAX_MCP_OUTPUT_TOKENS',
  'MAX_THINKING_TOKENS',
];

class ClaudeAI implements AIAgentTool {
  // constants
  public AGENT_BIN = 'claude';
  private promptBuilder = new PromptBuilder('claude');

  async checkAgent(): Promise<void> {
    try {
      await launch(this.AGENT_BIN, ['--version']);
    } catch (_err) {
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
      console.error('Failed to extract GitHub inputs with Claude:', error);
      return null;
    }
  }

  getContainerMounts(): string[] {
    const dockerMounts: string[] = [];
    const claudeFile = join(homedir(), '.claude.json');
    const claudeCreds = join(homedir(), '.claude', '.credentials.json');
    const gcloudConfig = join(homedir(), '.config', 'gcloud');

    dockerMounts.push(`-v`, `${claudeFile}:/.claude.json:Z,ro`);

    if (requiredClaudeCredentials()) {
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
    }

    if (requiredVertexAiCredentials()) {
      if (existsSync(gcloudConfig)) {
        dockerMounts.push(`-v`, `${gcloudConfig}:/.config/gcloud:Z,ro`);
      }
    }

    if (requiredBedrockCredentials()) {
      // TODO: mount bedrock credentials
    }

    return dockerMounts;
  }

  getEnvironmentVariables(): string[] {
    const envVars: string[] = [];

    // Look for any ANTHROPIC_* and CLAUDE_CODE_* env vars
    for (const key in process.env) {
      if (key.startsWith('ANTHROPIC_') || key.startsWith('CLAUDE_CODE_')) {
        envVars.push('-e', key);
      }
    }

    // Add other specific environment variables from CLAUDE_CODE_ENV_VARS
    for (const key of CLAUDE_CODE_ENV_VARS) {
      if (process.env[key] !== undefined) {
        envVars.push('-e', key);
      }
    }

    return envVars;
  }
}

export default ClaudeAI;
