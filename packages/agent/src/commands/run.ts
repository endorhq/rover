import { CommandOutput } from '../cli.js';
import colors from 'ansi-colors';
import {
  WorkflowManager,
  IterationStatusManager,
  JsonlLogger,
  showTitle,
  showProperties,
  showList,
  type StepResult,
  type WorkflowRunner,
  type OnStepComplete,
} from 'rover-core';
import {
  ROVER_LOG_FILENAME,
  AGENT_LOGS_DIR,
  isAgentStep,
  type WorkflowAgentStep,
} from 'rover-schemas';
import { parseCollectOptions } from '../lib/options.js';
import { Runner } from '../lib/runner.js';
import { ACPRunner } from '../lib/acp-runner.js';
import { createAgent } from '../lib/agents/index.js';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Helper function to display step results consistently for both ACP and standard runners
 */
function displayStepResults(
  stepName: string,
  result: StepResult,
  _totalDuration: number
): void {
  showTitle(`📊 Step Results: ${stepName}`);

  const props: Record<string, string> = {
    ID: colors.cyan(result.id),
    Status: result.success ? colors.green('✓ Success') : colors.red('✗ Failed'),
    Duration: colors.yellow(`${result.duration.toFixed(2)}s`),
  };

  if (result.error) {
    props['Error'] = colors.red(result.error);
  }

  showProperties(props);

  // Display outputs
  const outputEntries = Array.from(result.outputs.entries()).filter(
    ([key]) =>
      !key.startsWith('raw_') &&
      !key.startsWith('input_') &&
      key !== 'error' &&
      key !== 'error_code' &&
      key !== 'error_retryable'
  );

  if (outputEntries.length > 0) {
    const outputItems = outputEntries.map(([key, value]) => {
      // Truncate long values for display
      let displayValue =
        value.length > 100 ? value.substring(0, 100) + '...' : value;
      if (displayValue.includes('\n')) {
        displayValue = displayValue.split('\n')[0] + '...';
      }

      return `${key}: ${colors.cyan(displayValue)}`;
    });

    showList(outputItems, { title: colors.gray('Outputs:') });
  } else {
    console.log(colors.gray('No outputs extracted'));
  }
}

/**
 * Copy agent-produced logs from their source locations into the logs
 * directory so they are persisted on the host alongside rover.jsonl.
 */
function collectAgentLogs(logsDir: string, agentTool?: string): void {
  if (!agentTool) return;

  let sources: string[];
  try {
    sources = createAgent(agentTool).getLogSources();
  } catch {
    return;
  }
  if (sources.length === 0) return;

  const targetDir = join(logsDir, AGENT_LOGS_DIR);

  for (const src of sources) {
    if (!existsSync(src)) continue;
    try {
      mkdirSync(targetDir, { recursive: true });
      cpSync(src, targetDir, { recursive: true });
    } catch {
      // Best-effort: don't fail the workflow for log collection errors
    }
  }
}

interface RunCommandOptions {
  // Inputs. Take precedence over files
  input: string[];
  // Load the inputs from a JSON file
  inputsJson?: string;
  // Tool to use instead of workflow defaults
  agentTool?: string;
  // Model to use instead of workflow defaults
  agentModel?: string;
  // Task ID for status tracking
  taskId?: string;
  // Path to status.json file
  statusFile?: string;
  // Optional output directory
  output?: string;
  // Path to the context directory
  contextDir?: string;
}

interface RunCommandOutput extends CommandOutput {}

/**
 * Build context injection message from the context directory.
 * The context directory contains an index.md file and individual context source files.
 *
 * @param contextDir - Path to the context directory
 * @returns Context message to prepend to prompts, or null if no context
 */
function buildContextMessage(contextDir: string): string | null {
  const indexPath = `${contextDir}/index.md`;
  if (!existsSync(indexPath)) return null;

  const lines = [
    '\n\n**Context Sources:**',
    `The context directory at \`${contextDir}/\` contains reference materials for this task.`,
    `Read the index file at \`${contextDir}/index.md\` for a complete overview of all available context sources and their descriptions.`,
    '',
    '**Important:** Read the context index before proceeding with the task.',
    '',
  ];

  return lines.join('\n');
}

/**
 * Inject context sources into workflow step prompts.
 * Reads from the context directory mounted at the path specified by --context-dir.
 *
 * @param options - Run command options
 * @param workflowManager - Workflow manager to inject context into
 */
const handleContextInjection = (
  options: RunCommandOptions,
  workflowManager: WorkflowManager
): void => {
  const contextDir = options.contextDir;
  if (!contextDir || !existsSync(contextDir)) return;

  const contextMessage = buildContextMessage(contextDir);

  if (contextMessage && workflowManager.steps.length > 0) {
    console.log(
      colors.gray('✓ Context sources injected into workflow steps\n')
    );

    for (const step of workflowManager.steps) {
      if (isAgentStep(step)) {
        step.prompt = contextMessage + step.prompt;
      }
    }
  }
};

/**
 * Run a specific agent workflow file definition. It performs a set of validations
 * to confirm everything is ready and goes through the different steps.
 */
export const runCommand = async (
  workflowPath: string,
  options: RunCommandOptions = { input: [] }
) => {
  const output: RunCommandOutput = {
    success: false,
  };

  // Declare status manager outside try block so it's accessible in catch
  let statusManager: IterationStatusManager | undefined;
  let totalDuration = 0;

  // Determine the logs directory. Prefer /logs (bind-mounted by the sandbox
  // to the project-level logs directory), fall back to the output directory.
  const logsDir = existsSync('/logs') ? '/logs' : options.output;

  // Create JSONL logger for rover-specific structured logs.
  let logger: JsonlLogger | undefined;
  if (logsDir) {
    try {
      logger = new JsonlLogger(join(logsDir, ROVER_LOG_FILENAME));
    } catch (error) {
      console.log(
        colors.yellow(
          `Warning: Failed to initialize JSONL logger: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  }

  try {
    // Validate status tracking options
    if (options.statusFile && !options.taskId) {
      console.log(
        colors.red('\n✗ --task-id is required when --status-file is provided')
      );
      return;
    }

    // Check if the output folder exists.
    if (options.output && !existsSync(options.output)) {
      console.log(
        colors.red(
          `\n✗ The "${options.output}" directory does not exist or current user does not have permissions.`
        )
      );
      return;
    }

    // Create status manager if status file is provided
    if (options.statusFile && options.taskId) {
      try {
        statusManager = IterationStatusManager.createInitial(
          options.statusFile,
          options.taskId,
          'Starting workflow'
        );
      } catch (error) {
        console.log(
          colors.red(
            `\n✗ Failed to initialize status file: ${error instanceof Error ? error.message : String(error)}`
          )
        );
        output.error = `Failed to initialize status file: ${error}`;
        return;
      }
    }

    // Load the agent workflow
    const workflowManager = WorkflowManager.load(workflowPath);

    // Handle context sources injection
    handleContextInjection(options, workflowManager);

    let providedInputs = new Map();

    if (options.inputsJson != null) {
      console.log(colors.gray(`Loading inputs from ${options.inputsJson}\n`));
      if (!existsSync(options.inputsJson)) {
        console.log(
          colors.yellow(
            `The provided JSON input file (${options.inputsJson}) does not exist. Skipping it.`
          )
        );
      } else {
        try {
          const jsonData = readFileSync(options.inputsJson, 'utf-8');
          const data = JSON.parse(jsonData);

          for (const key in data) {
            providedInputs.set(key, data[key]);
          }
        } catch (err) {
          console.log(
            colors.yellow(
              `The provided JSON input file (${options.inputsJson}) is not a valid JSON. Skipping it.`
            )
          );
        }
      }
    }

    // Users might override the --inputs-json values with --input.
    // The --input always have preference
    providedInputs = parseCollectOptions(options.input, providedInputs);

    // Merge provided inputs with defaults
    const inputs = new Map(providedInputs);
    const defaultInputs: Array<string> = [];

    // Add default values for required inputs that weren't provided
    for (const input of workflowManager.inputs) {
      if (!inputs.has(input.name) && input.default !== undefined) {
        inputs.set(input.name, String(input.default));
        defaultInputs.push(input.name);
      }
    }

    showTitle('Agent Workflow');
    showProperties({
      Name: colors.cyan(workflowManager.name),
      Description: workflowManager.description,
    });

    const inputItems = Array.from(inputs.entries()).map(([key, value]) => {
      const isDefault = defaultInputs.includes(key);
      const suffix = isDefault ? colors.gray(' (default)') : '';
      return `${key}=${colors.cyan(String(value))}${suffix}`;
    });
    showList(inputItems, {
      title: colors.bold('User inputs'),
      addLineBreak: true,
    });

    // Validate inputs against workflow requirements
    const validation = workflowManager.validateInputs(inputs);

    // Display warnings if any
    if (validation.warnings.length > 0) {
      showList(
        validation.warnings.map((w: string) => colors.yellow(w)),
        { title: colors.yellow.bold('Warnings'), addLineBreak: true }
      );
    }

    // Check for validation errors
    if (!validation.valid) {
      validation.errors.forEach(error => {
        console.log(colors.red(`\n✗ ${error}`));
      });
      output.success = false;
      output.error = `Input validation failed: ${validation.errors.join(', ')}`;
    } else {
      // Continue with workflow run

      // Print Steps
      showList(
        workflowManager.steps.map((step, idx) => `${idx}. ${step.name}`),
        { title: colors.bold('Steps'), addLineBreak: true }
      );

      const totalSteps = workflowManager.steps.length;

      // Log workflow start
      logger?.info(
        'workflow_start',
        `Starting workflow: ${workflowManager.name}`,
        {
          taskId: options.taskId,
          metadata: {
            workflowName: workflowManager.name,
            totalSteps,
          },
        }
      );

      // Determine which tool to use
      // Priority: workflow defaults > CLI flag > fallback to claude
      // (per-step tool configuration takes precedence, handled in Runner/ACPRunner)
      const tool =
        options.agentTool || workflowManager.defaults?.tool || 'claude';

      // ACP usage decision: use ACP mode for agents that support it
      const acpEnabledTools = [
        'claude',
        'gemini',
        'copilot',
        'opencode',
        'qwen',
      ];
      const useACPMode = acpEnabledTools.includes(tool.toLowerCase());

      // Build the agent step executor based on mode
      let acpRunner: ACPRunner | undefined;

      if (useACPMode) {
        console.log(colors.cyan('\n🔗 ACP Mode enabled'));

        acpRunner = new ACPRunner({
          workflow: workflowManager,
          inputs,
          defaultTool: options.agentTool,
          defaultModel: options.agentModel,
          statusManager,
          outputDir: options.output,
          logger,
        });

        await acpRunner.initializeConnection();
      }

      const runner: WorkflowRunner = {
        runAgentStep: async (
          step: WorkflowAgentStep,
          stepIndex: number,
          stepsOutput: Map<string, Map<string, string>>
        ): Promise<StepResult> => {
          if (useACPMode && acpRunner) {
            try {
              await acpRunner.createSession();

              // Inject previous step outputs before running
              for (const [prevStepId, prevOutputs] of stepsOutput.entries()) {
                acpRunner.stepsOutput.set(prevStepId, prevOutputs);
              }

              return await acpRunner.runStep(step.id);
            } finally {
              acpRunner.closeSession();
            }
          } else {
            const stepRunner = new Runner(
              workflowManager,
              step.id,
              inputs,
              stepsOutput,
              options.agentTool,
              options.agentModel,
              statusManager,
              totalSteps,
              stepIndex,
              logger
            );

            return await stepRunner.run(options.output);
          }
        },
      };

      const onStepComplete: OnStepComplete = (step, result, context) => {
        displayStepResults(step.name, result, context.totalDuration);
      };

      try {
        const runResult = await workflowManager.run(runner, onStepComplete);

        totalDuration = runResult.totalDuration;

        // Display workflow completion summary
        const successfulSteps = Array.from(runResult.stepsOutput.keys()).length;
        const failedSteps = runResult.runSteps - successfulSteps;
        const skippedSteps = workflowManager.steps.length - runResult.runSteps;

        let status = colors.green('✓ Workflow Completed Successfully');
        if (failedSteps > 0) {
          status = colors.red('✗ Workflow Completed with Errors');
        } else if (skippedSteps > 0) {
          status =
            colors.green('✓ Workflow Completed Successfully ') +
            colors.yellow('(Some steps were skipped)');
        }

        showTitle('🎉 Workflow Execution Summary');
        showProperties({
          Duration: colors.cyan(runResult.totalDuration.toFixed(2) + 's'),
          'Total Steps': colors.cyan(workflowManager.steps.length.toString()),
          'Successful Steps': colors.green(successfulSteps.toString()),
          'Failed Steps': colors.red(failedSteps.toString()),
          'Skipped Steps': colors.yellow(skippedSteps.toString()),
          Status: status,
        });

        // Mark workflow as completed in status file
        if (failedSteps > 0) {
          output.success = false;
          output.error = runResult.error;
          logger?.error('workflow_fail', 'Workflow completed with errors', {
            taskId: options.taskId,
            duration: runResult.totalDuration,
            metadata: {
              successfulSteps,
              failedSteps,
              skippedSteps,
            },
          });
        } else {
          output.success = true;
          statusManager?.complete('Workflow completed successfully');
          logger?.info('workflow_complete', 'Workflow completed successfully', {
            taskId: options.taskId,
            duration: runResult.totalDuration,
            metadata: {
              successfulSteps,
              failedSteps: 0,
              skippedSteps,
            },
          });
        }
      } finally {
        // Always close the ACP runner after all steps are complete
        acpRunner?.close();
      }
    }
  } catch (err) {
    output.success = false;
    output.error = err instanceof Error ? err.message : `${err}`;
  }

  if (!output.success) {
    statusManager?.fail('Workflow execution', output.error || 'Unknown error');
    logger?.error('workflow_fail', output.error || 'Unknown error', {
      taskId: options.taskId,
      error: output.error,
      duration: totalDuration,
    });

    console.log(colors.red(`\n✗ ${output.error}`));
  }

  // Collect agent-specific logs into the logs directory
  if (logsDir) {
    collectAgentLogs(logsDir, options.agentTool);
  }

  process.exit(output.success ? 0 : 1);
};
