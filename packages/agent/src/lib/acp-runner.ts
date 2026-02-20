/**
 * ACP-based runner that maintains session context across workflow steps.
 * This runner uses the Agent Client Protocol (ACP) to communicate with
 * AI agents via a persistent session, saving time and tokens by not
 * re-injecting file contents for each step.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ContentBlock,
} from '@agentclientprotocol/sdk';
import colors from 'ansi-colors';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type {
  WorkflowAgentStep,
  WorkflowOutput,
  WorkflowStep,
} from 'rover-schemas';
import {
  WorkflowManager,
  IterationStatusManager,
  VERBOSE,
  JsonlLogger,
  showList,
  type StepResult,
} from 'rover-core';
import { ACPClient } from './acp-client.js';
import { copyFileSync, rmSync } from 'node:fs';

export interface ACPRunnerStepResult extends StepResult {}

export interface ACPRunnerConfig {
  workflow: WorkflowManager;
  inputs: Map<string, string>;
  defaultTool?: string;
  defaultModel?: string;
  statusManager?: IterationStatusManager;
  outputDir?: string;
  logger?: JsonlLogger;
}

/**
 * Get ACP spawn command for a given agent tool
 */
function getACPSpawnCommand(tool: string): { command: string; args: string[] } {
  switch (tool.toLowerCase()) {
    case 'claude':
      return {
        command: 'npx',
        args: ['-y', '@zed-industries/claude-code-acp'],
      };
    case 'copilot':
      return {
        command: 'copilot',
        args: ['--acp'],
      };
    case 'opencode':
      return {
        command: 'opencode',
        args: ['acp'],
      };
    default:
      throw new Error(`No ACP available for tool ${tool}`);
  }
}

export class ACPRunner {
  private workflow: WorkflowManager;
  private inputs: Map<string, string>;
  public stepsOutput: Map<string, Map<string, string>> = new Map();
  private defaultTool: string | undefined;
  private statusManager?: IterationStatusManager;
  private outputDir?: string;
  private logger?: JsonlLogger;

  // ACP connection state
  private agentProcess: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private client: ACPClient | null = null;
  private sessionId: string | null = null;
  private isConnectionInitialized: boolean = false;
  private isSessionCreated: boolean = false;
  private tool: string;

  constructor(config: ACPRunnerConfig) {
    this.workflow = config.workflow;
    this.inputs = config.inputs;
    this.defaultTool = config.defaultTool;
    this.statusManager = config.statusManager;
    this.outputDir = config.outputDir;
    this.logger = config.logger;

    // Determine which tool to use
    // Priority: CLI flag > workflow defaults > fallback to claude
    this.tool = config.defaultTool || this.workflow.defaults?.tool || 'claude';
  }

  /**
   * Initialize the ACP connection (protocol handshake)
   * Maps to the ACP initialize method
   */
  async initializeConnection(): Promise<void> {
    if (this.isConnectionInitialized) {
      return;
    }

    const spawnConfig = getACPSpawnCommand(this.tool);
    console.log(
      colors.blue(
        `\n🚀 Starting ACP agent: ${spawnConfig.command} ${spawnConfig.args.join(' ')}`
      )
    );

    // Spawn the agent as a subprocess
    this.agentProcess = spawn(spawnConfig.command, spawnConfig.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    // Forward stderr only in verbose mode
    if (this.agentProcess.stderr) {
      this.agentProcess.stderr.on('data', (chunk: Buffer) => {
        if (VERBOSE) {
          process.stderr.write(chunk);
        }
      });
    }

    if (!this.agentProcess.stdin || !this.agentProcess.stdout) {
      throw new Error('Failed to spawn agent process with proper I/O streams');
    }

    // Create streams to communicate with the agent
    const input = Writable.toWeb(this.agentProcess.stdin);
    const output = Readable.toWeb(
      this.agentProcess.stdout
    ) as ReadableStream<Uint8Array>;

    // Create the client connection
    this.client = new ACPClient();
    const stream = ndJsonStream(input, output);
    this.connection = new ClientSideConnection(_agent => this.client!, stream);

    try {
      // Initialize the connection (protocol handshake)
      const initResult = await this.connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
          terminal: true,
        },
      });

      this.isConnectionInitialized = true;

      console.log(
        colors.green(
          `✅ Connected to agent (protocol v${initResult.protocolVersion})`
        )
      );
    } catch (error) {
      this.close();
      throw new Error(
        `Failed to initialize ACP connection: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Create a new session
   * Maps to the ACP session/new method
   */
  async createSession(
    cwd?: string,
    mcpServers: Array<unknown> = []
  ): Promise<string> {
    if (!this.isConnectionInitialized || !this.connection) {
      throw new Error(
        'Connection not initialized. Call initializeConnection() first.'
      );
    }

    if (this.isSessionCreated) {
      throw new Error(
        'Session already created. Use the existing session or close it first.'
      );
    }

    try {
      // Create a new session
      const sessionResult = await this.connection.newSession({
        cwd: cwd || process.cwd(),
        mcpServers,
      });

      this.sessionId = sessionResult.sessionId;
      this.isSessionCreated = true;

      console.log(colors.gray(`📝 Created session: ${this.sessionId}`));

      return sessionResult.sessionId;
    } catch (error) {
      throw new Error(
        `Failed to create session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Send a prompt to the current session
   * Maps to the ACP session/prompt method
   *
   * Supports text, images (base64 or file:// URIs), and embedded resources.
   */
  async sendPrompt(
    prompt: string,
    options?: {
      /** Image attachments (base64 data or file:// URIs) */
      images?: Array<{
        data: string;
        mimeType: string;
        uri?: string;
      }>;
      /** Embedded text or blob resources */
      resources?: Array<{
        uri: string;
        mimeType?: string;
        text?: string;
        blob?: string;
      }>;
    }
  ): Promise<{ stopReason: string; response: string }> {
    if (!this.isConnectionInitialized || !this.connection) {
      throw new Error(
        'Connection not initialized. Call initializeConnection() first.'
      );
    }

    if (!this.isSessionCreated || !this.sessionId) {
      throw new Error('No active session. Call createSession() first.');
    }

    if (!this.client) {
      throw new Error('Client not initialized.');
    }

    try {
      // Start capturing agent messages
      this.client.startCapturing();

      // Build prompt content array
      const promptContent: ContentBlock[] = [
        {
          type: 'text',
          text: prompt,
        },
      ];

      // Add image attachments if provided
      if (options?.images) {
        for (const image of options.images) {
          promptContent.push({
            type: 'image',
            data: image.data,
            mimeType: image.mimeType,
            uri: image.uri,
          });
        }
      }

      // Add embedded resources if provided
      if (options?.resources) {
        for (const resource of options.resources) {
          if (resource.text !== undefined) {
            promptContent.push({
              type: 'resource',
              resource: {
                uri: resource.uri,
                mimeType: resource.mimeType,
                text: resource.text,
              },
            });
          } else if (resource.blob !== undefined) {
            promptContent.push({
              type: 'resource',
              resource: {
                uri: resource.uri,
                mimeType: resource.mimeType,
                blob: resource.blob,
              },
            });
          }
        }
      }

      const promptResult = await this.connection.prompt({
        sessionId: this.sessionId,
        prompt: promptContent,
      });

      // Stop capturing and get the accumulated response
      const response = this.client.stopCapturing();

      return { stopReason: promptResult.stopReason, response };
    } catch (error) {
      // Stop capturing on error too
      this.client.stopCapturing();
      throw new Error(
        `Failed to send prompt: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Set the model for the current session
   * Maps to the ACP session/set_model method (experimental)
   *
   * Allows changing the AI model used for subsequent prompts in the session.
   */
  async setModel(modelId: string): Promise<void> {
    if (!this.isConnectionInitialized || !this.connection) {
      throw new Error(
        'Connection not initialized. Call initializeConnection() first.'
      );
    }

    if (!this.isSessionCreated || !this.sessionId) {
      throw new Error('No active session. Call createSession() first.');
    }

    try {
      await this.connection.unstable_setSessionModel({
        sessionId: this.sessionId,
        modelId,
      });

      console.log(colors.gray(`🔄 Model changed to: ${modelId}`));
    } catch (error) {
      throw new Error(
        `Failed to set model: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Cancel an ongoing prompt operation
   * Maps to the ACP session/cancel notification
   *
   * Aborts any running language model requests and tool calls.
   */
  async cancelPrompt(): Promise<void> {
    if (!this.isConnectionInitialized || !this.connection) {
      throw new Error(
        'Connection not initialized. Call initializeConnection() first.'
      );
    }

    if (!this.isSessionCreated || !this.sessionId) {
      throw new Error('No active session. Call createSession() first.');
    }

    try {
      await this.connection.cancel({
        sessionId: this.sessionId,
      });

      console.log(
        colors.yellow(`⚠️  Prompt cancelled for session: ${this.sessionId}`)
      );
    } catch (error) {
      throw new Error(
        `Failed to cancel prompt: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Run a single workflow step using the ACP session
   */
  async runStep(stepId: string): Promise<ACPRunnerStepResult> {
    if (!this.isConnectionInitialized || !this.connection) {
      throw new Error(
        'Connection not initialized. Call initializeConnection() first.'
      );
    }

    if (!this.isSessionCreated || !this.sessionId) {
      throw new Error('No active session. Call createSession() first.');
    }

    const start = performance.now();
    const outputs = new Map<string, string>();
    const step = this.workflow.getStep(stepId);

    // Calculate current progress
    const stepIndex = this.workflow.steps.findIndex(
      (s: WorkflowStep) => s.id === stepId
    );
    const totalSteps = this.workflow.steps.length;
    const currentProgress = Math.floor((stepIndex / totalSteps) * 100);
    const nextProgress = Math.floor(((stepIndex + 1) / totalSteps) * 100);

    try {
      // Update status before executing step
      this.statusManager?.update('running', step.name, currentProgress);

      // Log step start
      this.logger?.info('step_start', `Starting step: ${step.name}`, {
        sessionId: this.sessionId ?? undefined,
        stepId: step.id,
        stepName: step.name,
        agent: this.tool,
        progress: currentProgress,
      });

      // Build the prompt for this step (simplified for ACP - no file content injection)
      const prompt = this.buildACPPrompt(step);

      console.log(
        colors.blue(
          `\n🤖 Running ${colors.blue.bold(step.name)} via ACP session`
        )
      );

      if (VERBOSE) {
        console.log(colors.gray('\n--- Prompt Start ---\n'));
        console.log(colors.gray(prompt));
        console.log(colors.gray('\n--- Prompt End ---\n'));
      }

      // Send the prompt via ACP session
      const promptResult = await this.sendPrompt(prompt);

      console.log(
        colors.gray(`\n✅ Agent completed with: ${promptResult.stopReason}`)
      );

      // Store common outputs
      outputs.set('raw_output', `Stop reason: ${promptResult.stopReason}`);
      outputs.set('input_prompt', prompt);

      // Parse the step outputs (pass agent response for output extraction)
      const { success: parseSuccess, error: parseError } =
        await this.parseStepOutputs(step, outputs, promptResult.response);

      if (!parseSuccess) {
        throw new Error(parseError || 'Failed to parse step outputs');
      }

      console.log(colors.green(`✓ Step '${step.name}' completed successfully`));

      // Update status after successful completion
      this.statusManager?.update('running', step.name, nextProgress);

      // Store outputs for next steps
      this.stepsOutput.set(stepId, outputs);

      const duration = (performance.now() - start) / 1000;

      // Log step completion
      this.logger?.info('step_complete', `Step completed: ${step.name}`, {
        sessionId: this.sessionId ?? undefined,
        stepId: step.id,
        stepName: step.name,
        agent: this.tool,
        duration,
      });

      return {
        id: step.id,
        success: true,
        duration,
        outputs,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      console.log(colors.red(`✗ Step '${step.name}' failed: ${errorMessage}`));

      outputs.set('error', errorMessage);

      const duration = (performance.now() - start) / 1000;

      // Log step failure
      this.logger?.error('step_fail', `Step failed: ${step.name}`, {
        sessionId: this.sessionId ?? undefined,
        stepId: step.id,
        stepName: step.name,
        agent: this.tool,
        duration,
        error: errorMessage,
      });

      return {
        id: step.id,
        success: false,
        error: errorMessage,
        duration,
        outputs,
      };
    }
  }

  /**
   * Build the prompt for an ACP step.
   * Like the non-ACP runner, file contents are injected directly into the prompt
   * to avoid the agent trying to read from stale file locations.
   */
  private buildACPPrompt(step: WorkflowAgentStep): string {
    let prompt = step.prompt;
    const placeholderRegex = /\{\{([^}]+)\}\}/g;
    const matches = [...prompt.matchAll(placeholderRegex)];
    const warnings: string[] = [];

    for (const match of matches) {
      const fullMatch = match[0];
      const placeholder = match[1].trim();
      let replacementValue: string | undefined;

      const parts = placeholder.split('.');

      if (parts[0] === 'inputs' && parts.length === 2) {
        // Format: {{inputs.input_name}}
        const inputName = parts[1];
        const inputValue = this.inputs.get(inputName);

        if (inputValue !== undefined) {
          replacementValue = inputValue;
        } else {
          warnings.push(`Input '${inputName}' not provided`);
        }
      } else if (
        parts[0] === 'steps' &&
        parts.length === 4 &&
        parts[2] === 'outputs'
      ) {
        // Format: {{steps.step_id.outputs.output_name}}
        const stepId = parts[1];
        const outputName = parts[3];
        const stepOutputs = this.stepsOutput.get(stepId);

        if (stepOutputs && stepOutputs.has(outputName)) {
          // Find the output definition
          const stepDef = this.workflow.steps.find(
            (s: WorkflowStep) => s.id === stepId
          );
          const outputDef = stepDef?.outputs?.find(
            (o: WorkflowOutput) => o.name === outputName
          );

          if (outputDef?.type === 'file') {
            // For file outputs, inject the file content directly into the prompt.
            // The content is stored as `${outputName}_content` by extractFileOutputs().
            // This ensures the agent doesn't try to read from stale file locations.
            const contentKey = `${outputName}_content`;
            const fileContent = stepOutputs.get(contentKey);
            if (fileContent) {
              replacementValue = fileContent;
            } else {
              warnings.push(
                `File content for '${outputName}' not found in step '${stepId}'`
              );
            }
          } else {
            replacementValue = stepOutputs.get(outputName) || '';
          }
        } else if (!stepOutputs) {
          warnings.push(`Step '${stepId}' has not been executed yet`);
        } else {
          warnings.push(`Output '${outputName}' not found in step '${stepId}'`);
        }
      } else {
        warnings.push(`Invalid placeholder format: '${placeholder}'`);
      }

      if (replacementValue !== undefined) {
        prompt = prompt.replace(fullMatch, replacementValue);
      }
    }

    // Add output instructions
    const outputInstructions = this.generateOutputInstructions(step);
    prompt += outputInstructions;

    // Display warnings if any
    if (warnings.length > 0) {
      showList(
        warnings.map(warning => colors.yellow(warning)),
        { title: colors.yellow.bold('\nPrompt Template Warnings:') }
      );
    }

    return prompt;
  }

  /**
   * Generate output instructions for a step
   */
  private generateOutputInstructions(step: WorkflowAgentStep): string {
    const stepOutputs = step.outputs || [];
    if (stepOutputs.length === 0) {
      return '';
    }

    const stringOutputs = stepOutputs.filter(
      output => output.type === 'string'
    );
    const fileOutputs = stepOutputs.filter(output => output.type === 'file');

    let instructions = '\n\n## OUTPUT REQUIREMENTS\n\n';
    instructions +=
      'You MUST provide your response in the exact format specified below:\n\n';

    if (stringOutputs.length > 0) {
      instructions += '### JSON Response\n\n';
      instructions += 'Return a JSON object with the following structure:\n\n';
      instructions += '```json\n{\n';

      stringOutputs.forEach((output, index) => {
        const comma = index < stringOutputs.length - 1 ? ',' : '';
        instructions += `  "${output.name}": "your_${output.name.toLowerCase()}_value_here"${comma}\n`;
      });

      instructions += '}\n```\n\n';

      instructions += 'Where:\n';
      stringOutputs.forEach(output => {
        instructions += `- \`${output.name}\`: ${output.description}\n`;
      });
      instructions += '\n';
    }

    if (fileOutputs.length > 0) {
      instructions += '### File Creation\n\n';
      instructions +=
        'You MUST create the following files with the exact content needed:\n\n';

      fileOutputs.forEach(output => {
        instructions += `- **${output.name}**: ${output.description}\n`;
        instructions += `  - Create this file in the current working directory\n`;
        instructions += `  - Filename: \`${output.filename}\`\n\n`;
      });

      instructions +=
        'IMPORTANT: All files must be created with appropriate content. Do not create empty or placeholder files.\n\n';
    }

    instructions += '**CRITICAL**: Follow these output requirements exactly. ';
    instructions +=
      'Your response will be automatically parsed, so any deviation from the specified format will cause errors.\n';

    return instructions;
  }

  /**
   * Parse step outputs from ACP execution
   */
  private async parseStepOutputs(
    step: WorkflowAgentStep,
    outputs: Map<string, string>,
    agentResponse: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const stepOutputs = step.outputs || [];

      // Extract file outputs by reading created files
      const fileOutputs = stepOutputs.filter(output => output.type === 'file');
      if (fileOutputs.length > 0) {
        await this.extractFileOutputs(fileOutputs, outputs);
      }

      // Extract string outputs from files or conventional JSON output
      const stringOutputs = stepOutputs.filter(
        output => output.type === 'string'
      );
      if (stringOutputs.length > 0) {
        await this.extractStringOutputs(
          step.id,
          stringOutputs,
          fileOutputs,
          outputs,
          agentResponse
        );
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to parse outputs: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Extract string outputs from ACP execution.
   * In ACP mode, string outputs can be extracted from:
   * 1. A conventional step outputs JSON file (_step_outputs.json)
   * 2. Corresponding file output content (e.g., context.md may contain "## Task complexity\nsimple")
   * 3. The raw agent response text (for JSON outputs like {"skipped": "true"})
   */
  private async extractStringOutputs(
    stepId: string,
    stringOutputs: Array<{ name: string; description: string }>,
    fileOutputs: Array<{
      name: string;
      description: string;
      filename?: string;
    }>,
    outputs: Map<string, string>,
    agentResponse: string
  ): Promise<void> {
    // First, try to read from a conventional step outputs JSON file
    const outputsFile = `_${stepId}_outputs.json`;
    let jsonData: Record<string, unknown> | null = null;

    if (existsSync(outputsFile)) {
      try {
        const content = readFileSync(outputsFile, 'utf-8');
        jsonData = JSON.parse(content);
        // Clean up the temporary file
        rmSync(outputsFile);
      } catch (error) {
        console.log(
          colors.yellow(`⚠️  Found ${outputsFile} but failed to parse it`)
        );
      }
    }

    // If no dedicated outputs file, try to extract from file output content
    if (!jsonData) {
      // Look for JSON in any file content that was already extracted
      for (const fileOutput of fileOutputs) {
        const contentKey = `${fileOutput.name}_content`;
        const content = outputs.get(contentKey);
        if (content) {
          // Try to find embedded JSON in the file content
          const extracted = this.extractJsonFromContent(content);
          if (extracted) {
            jsonData = extracted;
            break;
          }
        }
      }
    }

    // If still no JSON data, try to extract from the raw agent response
    if (!jsonData && agentResponse) {
      const extracted = this.extractJsonFromContent(agentResponse);
      if (extracted) {
        jsonData = extracted;
      }
    }

    // Extract each string output
    for (const output of stringOutputs) {
      let value: string | undefined;

      if (jsonData && typeof jsonData === 'object') {
        // Extract from parsed JSON
        const rawValue = jsonData[output.name];
        if (rawValue !== undefined) {
          value = String(rawValue);
        }
      }

      // If still not found, try to extract from file content using patterns
      if (value === undefined) {
        value = this.extractValueFromFileContent(output.name, outputs);
      }

      if (value !== undefined) {
        outputs.set(output.name, value);
        if (VERBOSE) {
          console.log(colors.gray(`  ✓ Extracted ${output.name}: ${value}`));
        }
      } else {
        console.log(
          colors.yellow(`⚠️  Output '${output.name}' not found in response`)
        );
        outputs.set(output.name, '[Not found in response]');
      }
    }
  }

  /**
   * Try to extract JSON data from content (looks for JSON blocks or raw JSON)
   */
  private extractJsonFromContent(
    content: string
  ): Record<string, unknown> | null {
    // Try to find a JSON code block
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch {
        // Not valid JSON in block
      }
    }

    // Try to find inline JSON object
    const inlineMatch = content.match(/\{[^{}]*"[^"]+"\s*:\s*"[^"]*"[^{}]*\}/);
    if (inlineMatch) {
      try {
        return JSON.parse(inlineMatch[0]);
      } catch {
        // Not valid JSON
      }
    }

    return null;
  }

  /**
   * Try to extract a string value from file content using common patterns
   * For example, "## Task complexity\nsimple" -> complexity = "simple"
   */
  private extractValueFromFileContent(
    outputName: string,
    outputs: Map<string, string>
  ): string | undefined {
    // Check all file content outputs
    for (const [key, content] of outputs.entries()) {
      if (!key.endsWith('_content')) continue;

      // Pattern 1: Markdown header followed by value
      // e.g., "## Task complexity\n\nsimple"
      const headerPattern = new RegExp(
        `##\\s*(?:Task\\s+)?${outputName}[\\s\\S]*?\\n+\\s*(simple|complex|true|false|\\w+)`,
        'i'
      );
      const headerMatch = content.match(headerPattern);
      if (headerMatch) {
        return headerMatch[1].toLowerCase();
      }

      // Pattern 2: Key-value format
      // e.g., "complexity: simple" or "issues_found: true"
      const kvPattern = new RegExp(
        `["']?${outputName}["']?\\s*[=:]\\s*["']?(\\w+)["']?`,
        'i'
      );
      const kvMatch = content.match(kvPattern);
      if (kvMatch) {
        return kvMatch[1].toLowerCase();
      }
    }

    return undefined;
  }

  /**
   * Extract file outputs by reading the created files
   */
  private async extractFileOutputs(
    fileOutputs: Array<{
      name: string;
      description: string;
      filename?: string;
    }>,
    outputs: Map<string, string>
  ): Promise<void> {
    for (const output of fileOutputs) {
      if (!output.filename) {
        console.log(
          colors.yellow(`⚠️  File output '${output.name}' missing filename`)
        );
        outputs.set(output.name, '[Missing filename]');
        continue;
      }

      try {
        if (existsSync(output.filename)) {
          let filePath = output.filename;

          if (this.outputDir) {
            filePath = join(this.outputDir, basename(output.filename));
            copyFileSync(output.filename, filePath);
            rmSync(output.filename);
          }

          const fileContent = readFileSync(filePath, 'utf-8');
          outputs.set(output.name, filePath);
          outputs.set(`${output.name}_content`, fileContent);
        } else {
          console.log(
            colors.yellow(
              `⚠️  Expected file '${output.filename}' was not created`
            )
          );
          outputs.set(output.name, '[File not created]');
        }
      } catch (error) {
        console.log(
          colors.yellow(
            `⚠️  Could not read file '${output.filename}': ${error instanceof Error ? error.message : String(error)}`
          )
        );
        outputs.set(output.name, '[Could not read file]');
      }
    }
  }

  /**
   * Get outputs from a specific step
   */
  getStepOutputs(stepId: string): Map<string, string> | undefined {
    return this.stepsOutput.get(stepId);
  }

  /**
   * Close just the current session without closing the connection
   * This allows creating a new session on the same connection
   */
  closeSession(): void {
    if (this.sessionId) {
      console.log(colors.gray(`🔌 Closing session: ${this.sessionId}`));
      this.sessionId = null;
      this.isSessionCreated = false;
    }
  }

  /**
   * Close the ACP connection and cleanup
   */
  close(): void {
    if (this.agentProcess) {
      console.log(colors.gray('\n🔌 Closing ACP connection...'));
      this.agentProcess.kill('SIGTERM');
      this.agentProcess = null;
    }
    this.connection = null;
    this.sessionId = null;
    this.isConnectionInitialized = false;
    this.isSessionCreated = false;
  }
}
