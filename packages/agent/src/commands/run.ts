import { CommandOutput } from '../cli.js';
import colors from 'ansi-colors';
import {
  WorkflowManager,
  IterationStatusManager,
  JsonlLogger,
} from 'rover-core';
import { ROVER_LOG_FILENAME, AGENT_LOGS_DIR } from 'rover-schemas';
import { parseCollectOptions } from '../lib/options.js';
import { Runner, RunnerStepResult } from '../lib/runner.js';
import { ACPRunner, ACPRunnerStepResult } from '../lib/acp-runner.js';
import { createAgent } from '../lib/agents/index.js';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Helper function to display step results consistently for both ACP and standard runners
 */
function displayStepResults(
  stepName: string,
  result: RunnerStepResult | ACPRunnerStepResult,
  _totalDuration: number
): void {
  console.log(colors.bold(`\n📊 Step Results: ${stepName}`));
  console.log(colors.gray('├── ID: ') + colors.cyan(result.id));
  console.log(
    colors.gray('├── Status: ') +
      (result.success ? colors.green('✓ Success') : colors.red('✗ Failed'))
  );
  console.log(
    colors.gray('├── Duration: ') +
      colors.yellow(`${result.duration.toFixed(2)}s`)
  );

  if (result.error) {
    console.log(colors.gray('├── Error: ') + colors.red(result.error));
  }

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
    console.log(colors.gray('└── Outputs:'));
    outputEntries.forEach(([key, value], idx) => {
      const prefix = idx === outputEntries.length - 1 ? '    └──' : '    ├──';
      // Truncate long values for display
      let displayValue =
        value.length > 100 ? value.substring(0, 100) + '...' : value;

      if (displayValue.includes('\n')) {
        displayValue = displayValue.split('\n')[0] + '...';
      }

      console.log(
        colors.gray(`${prefix} ${key}: `) + colors.cyan(displayValue)
      );
    });
  } else {
    console.log(colors.gray('└── No outputs extracted'));
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
      step.prompt = contextMessage + step.prompt;
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

    console.log(colors.bold('Agent Workflow'));
    console.log(colors.gray('├── Name: ') + colors.cyan(workflowManager.name));
    console.log(colors.gray('└── Description: ') + workflowManager.description);

    console.log(colors.bold('\nUser inputs'));
    const inputEntries = Array.from(inputs.entries());
    inputEntries.forEach(([key, value], idx) => {
      const prefix = idx == inputEntries.length - 1 ? '└──' : '├──';
      const isDefault = defaultInputs.includes(key);
      const suffix = isDefault ? colors.gray(' (default)') : '';
      console.log(`${prefix} ${key}=` + colors.cyan(`${value}`) + suffix);
    });

    // Validate inputs against workflow requirements
    const validation = workflowManager.validateInputs(inputs);

    // Display warnings if any
    if (validation.warnings.length > 0) {
      console.log(colors.yellow.bold('\nWarnings'));
      validation.warnings.forEach((warning, idx) => {
        const prefix = idx == validation.warnings.length - 1 ? '└──' : '├──';
        console.log(colors.yellow(`${prefix} ${warning}`));
      });
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
      const stepsOutput: Map<string, Map<string, string>> = new Map();

      // Print Steps
      console.log(colors.bold('\nSteps'));
      workflowManager.steps.forEach((step, idx) => {
        const prefix = idx == workflowManager.steps.length - 1 ? '└──' : '├──';
        console.log(`${prefix} ${idx}. ` + `${step.name}`);
      });

      let runSteps = 0;
      const totalSteps = workflowManager.steps.length;
      const stepResults: RunnerStepResult[] = [];

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

      // Temporarily ACP usage decision during ACP migration process:
      // force Claude, Copilot, and OpenCode to always use ACP mode
      const acpEnabledTools = ['claude', 'copilot', 'opencode'];
      const useACPMode = acpEnabledTools.includes(tool.toLowerCase());

      if (useACPMode) {
        console.log(colors.cyan('\n🔗 ACP Mode enabled'));

        // Create a single ACPRunner instance to be reused across all steps
        const acpRunner = new ACPRunner({
          workflow: workflowManager,
          inputs,
          defaultTool: options.agentTool,
          defaultModel: options.agentModel,
          statusManager,
          outputDir: options.output,
          logger,
        });

        try {
          // Initialize the ACP connection once (protocol handshake)
          await acpRunner.initializeConnection();

          // Run each step with a fresh session
          for (
            let stepIndex = 0;
            stepIndex < workflowManager.steps.length;
            stepIndex++
          ) {
            const step = workflowManager.steps[stepIndex];
            runSteps++;

            try {
              // Create a new session for this step
              await acpRunner.createSession();

              // Inject previous step outputs before running
              for (const [prevStepId, prevOutputs] of stepsOutput.entries()) {
                acpRunner.stepsOutput.set(prevStepId, prevOutputs);
              }

              // Run this single step in its fresh session
              const result = await acpRunner.runStep(step.id);
              stepResults.push(result);

              // Display step results
              displayStepResults(step.name, result, totalDuration);
              totalDuration += result.duration;

              // Store step outputs for next steps
              if (result.success) {
                stepsOutput.set(step.id, result.outputs);
              } else {
                const continueOnError =
                  workflowManager.config?.continueOnError || false;
                if (!continueOnError) {
                  console.log(
                    colors.red(
                      `\n✗ Step '${step.name}' failed and continueOnError is false. Stopping workflow execution.`
                    )
                  );
                  output.success = false;
                  output.error = `Workflow stopped due to step failure: ${result.error}`;
                  break;
                } else {
                  console.log(
                    colors.yellow(
                      `\n⚠ Step '${step.name}' failed but continueOnError is true. Continuing with next step.`
                    )
                  );
                  stepsOutput.set(step.id, new Map());
                }
              }
            } finally {
              // Close the session after this step (but keep the connection alive)
              acpRunner.closeSession();
            }
          }
        } finally {
          // Always close the ACP runner after all steps are complete
          acpRunner.close();
        }
      } else {
        // Standard subprocess-based execution (existing behavior)
        for (
          let stepIndex = 0;
          stepIndex < workflowManager.steps.length;
          stepIndex++
        ) {
          const step = workflowManager.steps[stepIndex];
          const runner = new Runner(
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

          runSteps++;

          // Run it
          const result = await runner.run(options.output);

          // Display step results
          displayStepResults(step.name, result, totalDuration);
          totalDuration += result.duration;

          // Store step outputs for next steps to use
          if (result.success) {
            stepsOutput.set(step.id, result.outputs);
          } else {
            // If step failed, decide whether to continue based on workflow config
            const continueOnError =
              workflowManager.config?.continueOnError || false;
            if (!continueOnError) {
              console.log(
                colors.red(
                  `\n✗ Step '${step.name}' failed and continueOnError is false. Stopping workflow execution.`
                )
              );
              output.success = false;
              output.error = `Workflow stopped due to step failure: ${result.error}`;
              break;
            } else {
              console.log(
                colors.yellow(
                  `\n⚠ Step '${step.name}' failed but continueOnError is true. Continuing with next step.`
                )
              );
              // Store empty outputs for failed step
              stepsOutput.set(step.id, new Map());
            }
          }
        }
      }

      // Display workflow completion summary
      console.log(colors.bold('\n🎉 Workflow Execution Summary'));
      console.log(
        colors.gray('├── Duration: ') +
          colors.cyan(totalDuration.toFixed(2) + 's')
      );
      console.log(
        colors.gray('├── Total Steps: ') +
          colors.cyan(workflowManager.steps.length.toString())
      );

      const successfulSteps = Array.from(stepsOutput.keys()).length;
      console.log(
        colors.gray('├── Successful Steps: ') +
          colors.green(successfulSteps.toString())
      );

      const failedSteps = runSteps - successfulSteps;
      console.log(
        colors.gray('├── Failed Steps: ') + colors.red(failedSteps.toString())
      );

      const skippedSteps = workflowManager.steps.length - runSteps;
      console.log(
        colors.gray('├── Skipped Steps: ') +
          colors.yellow(failedSteps.toString())
      );

      let status = colors.green('✓ Workflow Completed Successfully');

      if (failedSteps > 0) {
        status = colors.red('✗ Workflow Completed with Errors');
      } else if (skippedSteps > 0) {
        status =
          colors.green('✓ Workflow Completed Successfully ') +
          colors.yellow('(Some steps were skipped)');
      }

      console.log(colors.gray('└── Status: ') + status);

      // Mark workflow as completed in status file
      if (failedSteps > 0) {
        output.success = false;
        logger?.error('workflow_fail', 'Workflow completed with errors', {
          taskId: options.taskId,
          duration: totalDuration,
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
          duration: totalDuration,
          metadata: {
            successfulSteps,
            failedSteps: 0,
            skippedSteps,
          },
        });
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
