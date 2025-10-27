/**
 * The runner class receives a configuration and a step and run it
 * using the given agent. It ensures the agent has all the information
 * by building the prompt and passing it.
 */

import { launch, launchSync, VERBOSE } from 'rover-common';
import colors from 'ansi-colors';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import type { WorkflowAgentStep, WorkflowOutputType } from 'rover-schemas';
import { WorkflowManager, IterationStatusManager } from 'rover-schemas';
import {
  parseAgentError,
  isWaitingForAuthentication,
  AgentError,
  AuthenticationError,
  TimeoutError,
} from './errors.js';
import { basename, join } from 'node:path';

export interface RunnerStepResult {
  // Step ID
  id: string;
  // Run result (success or not)
  success: boolean;
  // Error
  error?: string;
  // Duration in seconds
  duration: number;
  // Consumed tokens
  tokens?: number;
  // Cost
  cost?: number;
  // Parsed output
  outputs: Map<string, string>;
}

export class Runner {
  // The step to run
  private step: WorkflowAgentStep;
  // Final tool to run the step
  tool: string;

  // Use current data to initialize the runner
  constructor(
    private workflow: WorkflowManager,
    stepId: string,
    private inputs: Map<string, string>,
    private stepsOutput: Map<string, Map<string, string>>,
    private defaultTool: string | undefined,
    private defaultModel: string | undefined,
    private statusManager?: IterationStatusManager,
    private totalSteps: number = 0,
    private currentStepIndex: number = 0
  ) {
    // Get the step from the workflow
    this.step = this.workflow.getStep(stepId);

    // Determine which tool to use
    const stepTool = this.workflow.getStepTool(stepId, this.defaultTool);

    if (!stepTool) {
      throw new Error(
        'The workflow does not specify any AI Coding Agent and the user did not provide it.'
      );
    }

    // Check if the tool is available
    let availableTool: string | undefined;

    // Try the step-specific tool first
    try {
      launchSync(stepTool, ['--version']);
      availableTool = stepTool;
    } catch (err) {
      console.log(colors.yellow(`${stepTool} is not available in the system`));

      // Try fallback to default tool if different
      const fallbackTool = stepTool || this.workflow.defaults?.tool;
      if (fallbackTool && fallbackTool !== stepTool) {
        try {
          launchSync(fallbackTool, ['--version']);
          availableTool = fallbackTool;
          console.log(colors.gray(`Falling back to ${fallbackTool}`));
        } catch (err) {
          // No fallback available
        }
      }
    }

    if (availableTool) {
      this.tool = availableTool;
    } else {
      throw new Error(`Could not find any tool to run the '${stepId}' step`);
    }
  }

  /**
   * Run the given step in the workflow. It assumes the output folder exists
   * when present.
   *
   * @param output A target directory to move output files
   * @returns The runner result or an error
   */
  async run(output?: string): Promise<RunnerStepResult> {
    const start = performance.now();
    const outputs = new Map<string, string>();
    let agentError: AgentError | undefined;

    // Calculate current progress
    const currentProgress = this.calculateProgress(this.currentStepIndex);
    const nextProgress = this.calculateProgress(this.currentStepIndex + 1);

    try {
      // Update status before executing step
      this.statusManager?.update('running', this.step.name, currentProgress);

      // Get the processed prompt
      const finalPrompt = this.prompt();

      // Get the command arguments
      const args = this.toolArguments();

      // Execute the AI tool with the prompt
      console.log(
        colors.blue(
          `\n🤖 Running ${colors.blue.bold(this.step.name)} ${colors.grey('>')} ${colors.cyan(this.tool)}`
        )
      );

      if (VERBOSE) {
        console.log(colors.gray('============== Input Prompt ============== '));
        console.log(colors.gray(finalPrompt));
        console.log(
          colors.gray('============== End Input Prompt ============== ')
        );
      }

      // Create abort controller for killing process if auth detected
      const abortController = new AbortController();
      let authDetected = false;
      let stderrBuffer = '';

      /**
       * Detects if the otuput includes a "Waiting for authentication" kind of message
       * to abort the current execution without waiting for the timeout. Tools like
       * Gemini and Qwen behaves this way
       */
      const authWaitingDetector = function* (chunk: unknown) {
        const chunkStr = String(chunk);
        stderrBuffer += chunkStr;

        // Check for authentication prompts
        if (isWaitingForAuthentication(stderrBuffer) && !authDetected) {
          authDetected = true;
          console.log(
            colors.yellow(
              '\n⚠ Authentication prompt detected, terminating process...'
            )
          );
          abortController.abort();
        }

        // Always return the chunk. If not, the stderr will be empty.
        yield chunk;
      };

      // Launch the process with proper timeout and abort signal
      const launchPromise = launch(this.tool, args, {
        input: finalPrompt,
        timeout: this.workflow.getStepTimeout(this.step.id) * 1000, // Convert to milliseconds
        cancelSignal: abortController.signal,
        reject: true, // Reject on non-zero exit codes
        buffer: true, // Buffer output for error parsing
        // Capture stderr in real-time to detect auth prompts
        stderr: ['pipe', authWaitingDetector],
      });

      const result = await launchPromise;

      // Check if authentication was detected
      if (authDetected) {
        abortController.abort();
        throw new AuthenticationError(
          'Agent requires authentication - process was terminated',
          this.tool
        );
      }

      // Store common outputs
      const rawOutput = result.stdout ? result.stdout.toString() : '';
      outputs.set('raw_output', rawOutput);
      outputs.set('input_prompt', finalPrompt);

      // Parse the actual outputs based on this.step.outputs definitions
      const { success: parseSuccess, error: parseError } =
        await this.parseStepOutputs(rawOutput, outputs, output);

      if (!parseSuccess) {
        throw new Error(parseError || 'Failed to parse step outputs');
      }

      console.log(
        colors.green(`✓ Step '${this.step.name}' completed successfully`)
      );

      // Update status after successful completion
      this.statusManager?.update('running', this.step.name, nextProgress);
    } catch (error) {
      // Handle different error types
      if (error instanceof AgentError) {
        agentError = error;
      } else if (error && typeof error === 'object' && 'exitCode' in error) {
        // Execa error with exit code
        const execaError = error as any;
        const stderr = execaError.stderr || '';
        const stdout = execaError.stdout || '';
        const exitCode = execaError.exitCode;

        // Check for timeout
        if (execaError.timedOut) {
          agentError = new TimeoutError(
            `Step '${this.step.name}' exceeded timeout of ${this.workflow.getStepTimeout(this.step.id)}s`,
            this.workflow.getStepTimeout(this.step.id) * 1000
          );
        } else if (execaError.isCanceled) {
          // Process was canceled (likely due to auth prompt)
          agentError = new AuthenticationError(
            'Agent requires authentication - process was terminated',
            this.tool
          );
        } else {
          // Parse the error from stderr/stdout
          agentError = parseAgentError(stderr, stdout, exitCode, this.tool);
        }
      } else if (error instanceof Error) {
        // Generic error
        const errorMessage = error.message;
        if (errorMessage.includes('timeout')) {
          agentError = new TimeoutError(
            `Step '${this.step.name}' exceeded timeout`,
            this.workflow.getStepTimeout(this.step.id) * 1000
          );
        } else {
          agentError = parseAgentError(errorMessage, '', null, this.tool);
        }
      } else {
        // Unknown error type
        agentError = parseAgentError(String(error), '', null, this.tool);
      }

      console.log(
        colors.red(`✗ Step '${this.step.name}' failed: ${agentError.message}`)
      );

      // Add error classification info
      if (agentError instanceof AuthenticationError) {
        console.log(colors.gray(`  Error type: Authentication required`));
        console.log(
          colors.cyan(`  Please authenticate with ${this.tool} and try again`)
        );
      } else if (agentError.isRetryable) {
        console.log(
          colors.gray(`  Error type: ${agentError.code} (retryable)`)
        );
      } else {
        console.log(colors.gray(`  Error type: ${agentError.code}`));
      }

      // Store error information
      outputs.set('error', agentError.message);
      outputs.set('error_code', agentError.code);
      outputs.set('error_retryable', String(agentError.isRetryable));
    }

    const result: RunnerStepResult = {
      id: this.step.id,
      success: !outputs.has('error'), // Success if no error was stored
      error: outputs.get('error'),
      duration: (performance.now() - start) / 1000, // Convert to seconds
      outputs,
    };

    return result;
  }

  /**
   * Parse step outputs from the agent response
   */
  private async parseStepOutputs(
    rawOutput: string,
    outputs: Map<string, string>,
    outputDir?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Check if this tool uses JSON output format
      const usesJsonFormat = this.toolUsesJsonFormat();

      let responseContent = rawOutput;
      let parsedResponse: any = null;

      // Parse JSON response if the tool uses JSON format
      if (usesJsonFormat) {
        try {
          parsedResponse = JSON.parse(rawOutput);

          if (this.tool === 'claude') {
            // Currently, claude uses "result"
            responseContent =
              parsedResponse.result ||
              parsedResponse.content ||
              parsedResponse.message;
          } else if (this.tool === 'gemini') {
            // Currently, gemini uses "response"
            responseContent =
              parsedResponse.response ||
              parsedResponse.content ||
              parsedResponse.text;
          }
        } catch (jsonError) {
          console.log(
            colors.yellow(
              '⚠️  Expected JSON format but got invalid JSON, treating as raw text'
            )
          );
          responseContent = rawOutput;
        }
      }

      // Extract string outputs from the response
      const stepOutputs = this.step.outputs || [];
      const stringOutputs = stepOutputs.filter(
        output => output.type === 'string'
      );
      if (stringOutputs.length > 0) {
        await this.extractStringOutputs(
          responseContent,
          stringOutputs,
          outputs
        );
      }

      // Extract file outputs by reading created files
      const fileOutputs = stepOutputs.filter(output => output.type === 'file');
      if (fileOutputs.length > 0) {
        await this.extractFileOutputs(fileOutputs, outputs, outputDir);
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
   * Check if the current tool uses JSON output format
   */
  private toolUsesJsonFormat(): boolean {
    switch (this.tool) {
      case 'claude':
      case 'gemini':
        return true;
      default:
        return false;
    }
  }

  /**
   * Extract string outputs from the agent response
   */
  private async extractStringOutputs(
    responseContent: string,
    stringOutputs: Array<{ name: string; description: string }>,
    outputs: Map<string, string>
  ): Promise<void> {
    // Try to parse JSON from the response content if it looks like JSON
    let jsonData: any = null;

    // First, try to parse the entire response as JSON
    try {
      jsonData = JSON.parse(responseContent);
    } catch (error) {
      // Not JSON, will need to extract manually
    }

    // If the response is invalid, look for JSON block in the response
    if (jsonData == null) {
      const jsonMatch = responseContent.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          jsonData = JSON.parse(jsonMatch[1]);
        } catch (error) {
          console.log(
            colors.yellow('⚠️  Found JSON block but failed to parse it')
          );
        }
      }
    }

    // Extract each string output
    for (const output of stringOutputs) {
      let value: string | undefined;

      if (jsonData && typeof jsonData === 'object') {
        // Extract from parsed JSON
        value = jsonData[output.name];
      } else {
        console.log(
          colors.yellow(
            `⚠️  Could not extract '${output.name}' from non-JSON response`
          )
        );
        value = `[Could not extract from response]`;
      }

      if (value !== undefined) {
        outputs.set(output.name, String(value));
      } else {
        console.log(
          colors.yellow(`⚠️  Output '${output.name}' not found in response`)
        );
        outputs.set(output.name, '[Not found in response]');
      }
    }
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
    outputs: Map<string, string>,
    outputDir?: string
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

          if (outputDir) {
            filePath = join(outputDir, basename(output.filename));
            // Avoid using fs.rename or fs.renameSync here as it will fail when they are
            // in different partitions (common for docker mounted folders).
            // @see https://stackoverflow.com/questions/43206198/what-does-the-exdev-cross-device-link-not-permitted-error-mean
            copyFileSync(output.filename, filePath);
            rmSync(output.filename);
          }

          const fileContent = readFileSync(filePath, 'utf-8');
          outputs.set(output.name, filePath); // Store the filename as the value
          outputs.set(`${output.name}_content`, fileContent); // Store content separately
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
   * Get the command line arguments for the specific AI tool
   */
  private toolArguments(): string[] {
    const model = this.workflow.getStepModel(this.step.id);

    switch (this.tool) {
      case 'claude': {
        const args = [
          '--dangerously-skip-permissions',
          '--output-format',
          'json',
        ];

        // Add model if specified
        // TODO: Enable selecting the model
        // if (model) {
        //   args.push('--model', model);
        // }

        args.push('-p');

        return args;
      }
      case 'codex': {
        const args = [
          'exec',
          '--dangerously-bypass-approvals-and-sandbox',
          '--skip-git-repo-check',
        ];

        // Add model if specified
        // TODO: Enable selecting the model
        // if (model) {
        //   args.push('--model', model);
        // }

        // Read the input from stdin
        args.push('-');

        return args;
      }
      case 'gemini': {
        const args = ['--yolo', '--output-format', 'json'];

        // Add model if specified
        // TODO: Enable selecting the model
        // if (model) {
        //   args.push('--model', model);
        // }

        // Do not add -p as it's deprecated

        return args;
      }
      case 'qwen': {
        // JSON Mode is not supported on qwen yet.
        const args = ['--yolo'];

        // Add model if specified
        // TODO: Enable selecting the model
        // if (model) {
        //   args.push('--model', model);
        // }

        // For now, this is not deprecated in Qwen
        args.push('-p');

        return args;
      }
      default: {
        // TODO(angel): Shall we halt at this point and raise an exception?
        return ['--dangerously-skip-permissions', '-p'];
      }
    }
  }

  /**
   * Load value based on its type - reads file content for 'file' type, returns as-is for 'string' type
   */
  private loadValueByType(
    value: string,
    type: WorkflowOutputType,
    warnings: string[]
  ): string {
    if (type === 'file') {
      // It's a file type, read the file content
      if (existsSync(value)) {
        try {
          return readFileSync(value, 'utf-8');
        } catch (err) {
          warnings.push(
            `Could not read file '${value}': ${err instanceof Error ? err.message : String(err)}`
          );
          return value; // Use path as fallback
        }
      } else {
        warnings.push(`File '${value}' does not exist`);
        return value; // Use path as fallback
      }
    } else {
      // It's a string type or undefined, use as-is
      return value;
    }
  }

  /**
   * Generate output instructions based on the step's expected outputs
   */
  private generateOutputInstructions(): string {
    const stepOutputs = this.step.outputs || [];
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

    // Handle string outputs (JSON format)
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

    // Handle file outputs
    if (fileOutputs.length > 0) {
      instructions += '### File Creation\n\n';
      instructions +=
        'You MUST create the following files with the exact content needed:\n\n';

      fileOutputs.forEach(output => {
        instructions += `- **${output.name}**: ${output.description}\n`;
        instructions += `  - Create this file in the current working directory\n`;

        if (this.tool == 'gemini' || this.tool == 'qwen') {
          // Gemini has difficulties calling its own tools
          instructions += `  - When creating the file, call the write_file tool using an absolute path based on current directory. THIS IS MANDATORY\n`;
        }

        instructions += `  - Filename: \`${output.filename}\`\n\n`;
      });

      instructions +=
        'IMPORTANT: All files must be created with appropriate content. Do not create empty or placeholder files.\n\n';
    }

    // Combined instructions
    if (stringOutputs.length > 0 && fileOutputs.length > 0) {
      instructions += '### Combined Response Format\n\n';
      instructions +=
        '1. First, create all required files as specified above\n';
      instructions +=
        '2. Then, provide the JSON response with the string outputs\n';
      instructions +=
        '3. Make sure all files are created before ending your response\n\n';
    }

    // Final emphasis
    instructions += '**CRITICAL**: Follow these output requirements exactly. ';
    instructions +=
      'Your response will be automatically parsed, so any deviation from the specified format will cause errors.\n';

    return instructions;
  }

  /**
   * Build the final prompt by parsing the template and replacing placeholders.
   * Supports the following placeholder formats:
   * - {{inputs.input_name}} - replaced with user input value or file content
   * - {{steps.step_id.outputs.output_name}} - replaced with step output value or file content
   *
   * If the type is 'file', reads the file content from the absolute path.
   * Warns when placeholders cannot be fulfilled or files don't exist.
   * Adds output instructions based on the step's expected outputs.
   */
  prompt(): string {
    let finalPrompt = this.step.prompt;
    const placeholderRegex = /\{\{([^}]+)\}\}/g;
    const matches = [...finalPrompt.matchAll(placeholderRegex)];
    const warnings: string[] = [];

    for (const match of matches) {
      const fullMatch = match[0];
      const placeholder = match[1].trim();
      let replacementValue: string | undefined;

      // Parse the placeholder path
      const parts = placeholder.split('.');

      if (parts[0] === 'inputs' && parts.length == 2) {
        // Format: {{inputs.input_name}}
        const inputName = parts.slice(1).join('.');
        const inputValue = this.inputs.get(inputName);

        if (inputValue !== undefined) {
          // Inputs are always string values (never files)
          // The input type (string/number/boolean) just indicates validation,
          // but in the context of template replacement, we use the string value directly
          replacementValue = inputValue;
        } else {
          warnings.push(`Input '${inputName}' not provided`);
        }
      } else if (
        parts[0] === 'steps' &&
        parts.length == 4 &&
        parts[2] === 'outputs'
      ) {
        // Format: {{steps.step_id.outputs.output_name}}
        const stepId = parts[1];
        const outputName = parts.slice(3).join('.');
        const stepOutputs = this.stepsOutput.get(stepId);

        if (stepOutputs && stepOutputs.has(outputName)) {
          const outputValue = stepOutputs.get(outputName) || '';

          // Find the step and output definition to check its type
          const stepDef = this.workflow.steps.find(s => s.id === stepId);
          const outputDef = stepDef?.outputs?.find(o => o.name === outputName);

          if (!outputDef) {
            warnings.push(
              `The output '${outputName}' definition in step '${stepId}' is missing`
            );
          } else {
            replacementValue = this.loadValueByType(
              outputValue,
              outputDef.type,
              warnings
            );
          }
        } else if (!stepOutputs) {
          warnings.push(`Step '${stepId}' has not been executed yet`);
        } else {
          warnings.push(`Output '${outputName}' not found in step '${stepId}'`);
        }
      } else {
        // Unknown placeholder format
        warnings.push(`Invalid placeholder format: '${placeholder}'`);
      }

      // Replace the placeholder with the value or leave as-is if unresolved
      if (replacementValue !== undefined) {
        finalPrompt = finalPrompt.replace(fullMatch, replacementValue);
      }
    }

    // Add output instructions
    const outputInstructions = this.generateOutputInstructions();
    finalPrompt += outputInstructions;

    // Display warnings if any
    if (warnings.length > 0) {
      console.log(colors.yellow.bold('\nPrompt Template Warnings:'));
      warnings.forEach((warning, idx) => {
        const prefix = idx === warnings.length - 1 ? '└──' : '├──';
        console.log(colors.yellow(`${prefix} ${warning}`));
      });
    }

    return finalPrompt;
  }

  /**
   * Calculate progress percentage based on current step index
   */
  private calculateProgress(stepIndex: number): number {
    if (this.totalSteps === 0) return 0;
    return Math.floor((stepIndex / this.totalSteps) * 100);
  }
}
