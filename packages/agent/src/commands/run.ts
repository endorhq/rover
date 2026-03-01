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
  AGENT_EXIT_CODE,
  isAgentStep,
  isLoopStep,
  type WorkflowAgentStep,
  type WorkflowStep,
} from 'rover-schemas';
import { parseCollectOptions } from '../lib/options.js';
import { ACPRunner } from '../lib/acp-runner.js';
import { createAgent } from '../lib/agents/index.js';
import {
  executeStep,
  isRetryableError,
  isTransientError,
  PauseWorkflowError,
  collectNestedStepIds,
} from '../lib/step-executor.js';
import {
  clearCheckpointFile,
  createCheckpointStore,
  loadCheckpoint,
  saveCheckpoint,
  type CheckpointData,
  type CheckpointStore,
} from '../lib/checkpoint-store.js';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export {
  isRetryableError,
  isTransientError,
  loadCheckpoint,
  saveCheckpoint,
  type CheckpointData,
};

const EXIT_SUCCESS = AGENT_EXIT_CODE.SUCCESS;
const EXIT_FAILED = AGENT_EXIT_CODE.FAILED;
const EXIT_PAUSED = AGENT_EXIT_CODE.PAUSED;

/**
 * Helper function to display step results consistently for both ACP and standard runners
 */
function displayStepResults(stepName: string, result: StepResult): void {
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
  // Path to checkpoint.json for resuming a paused workflow
  checkpoint?: string;
}

interface RunCommandOutput extends CommandOutput {
  paused?: boolean;
}

function upsertCompletedStep(
  completedSteps: CheckpointData['completedSteps'],
  id: string,
  outputs: Record<string, string>
): void {
  const existingIndex = completedSteps.findIndex(step => step.id === id);
  const nextCompletedStep = { id, outputs };
  if (existingIndex >= 0) {
    completedSteps[existingIndex] = nextCompletedStep;
  } else {
    completedSteps.push(nextCompletedStep);
  }
}

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
 * Recursively inject context into agent steps, including those nested inside loops.
 */
function injectContextIntoSteps(
  steps: WorkflowStep[],
  contextMessage: string
): void {
  for (const step of steps) {
    if (isAgentStep(step)) {
      step.prompt = contextMessage + step.prompt;
    } else if (isLoopStep(step)) {
      injectContextIntoSteps(step.steps, contextMessage);
    }
  }
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

    injectContextIntoSteps(workflowManager.steps, contextMessage);
  }
};

/**
 * Try to find the cached result for a step in the checkpoint data.
 * Returns a synthetic StepResult if found, undefined otherwise.
 */
function getCachedStepResult(
  checkpointStore: CheckpointStore | undefined,
  step: WorkflowStep,
  stepsOutput: Map<string, Map<string, string>>
): StepResult | undefined {
  if (!checkpointStore) return undefined;
  const cached = checkpointStore.getCompletedStep(step.id);
  if (!cached) return undefined;

  if (isLoopStep(step)) {
    for (const subStepId of step.steps.flatMap((subStep: WorkflowStep) =>
      collectNestedStepIds(subStep)
    )) {
      const subStep = checkpointStore.getCompletedStep(subStepId);
      if (!subStep) continue;
      stepsOutput.set(subStepId, new Map(Object.entries(subStep.outputs)));
    }
  }

  console.log(colors.gray(`\n⏭ Skipping completed step: ${step.name}`));
  return {
    id: step.id,
    success: true,
    duration: 0,
    outputs: new Map(Object.entries(cached.outputs)),
  };
}

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
  let sigtermHandler: (() => void) | undefined;
  let sigintHandler: (() => void) | undefined;
  let shutdownSignal: string | undefined;

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

      // Load checkpoint if resuming from a paused workflow
      let checkpoint: CheckpointData | null = null;
      if (options.checkpoint) {
        checkpoint = loadCheckpoint(options.checkpoint);
        if (checkpoint) {
          // Validate checkpoint step IDs against the current workflow.
          // If the workflow was edited between pause and resume, stale
          // entries could cause steps to be skipped incorrectly.
          const validSteps = checkpoint.completedSteps.filter(step =>
            workflowManager.findStep(step.id)
          );
          const droppedCount =
            checkpoint.completedSteps.length - validSteps.length;
          if (droppedCount > 0) {
            console.log(
              colors.yellow(
                `\n⚠ Dropped ${droppedCount} checkpoint entry(s) referencing steps no longer in the workflow`
              )
            );
            checkpoint.completedSteps = validSteps;
          }

          console.log(
            colors.cyan(
              `\n🔄 Resuming from checkpoint: ${checkpoint.completedSteps.length} step(s) will be skipped`
            )
          );
        } else {
          console.log(
            colors.yellow(
              '\n⚠ Checkpoint file not found or invalid, running full workflow'
            )
          );
        }
      }
      const checkpointStore = createCheckpointStore(options.output, checkpoint);
      // Shared with signal handlers so Ctrl+C/termination can close ACP cleanly.
      let acpRunner: ACPRunner | undefined;

      // Register signal handlers for graceful checkpoint save on termination.
      // Without these, a SIGTERM/SIGINT during step execution would lose any
      // in-flight checkpoint state between step completion and the next persist.
      let shuttingDown = false;
      const gracefulShutdown = (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        shutdownSignal = signal;
        output.paused = true;
        output.success = false;
        output.error = `Workflow paused by ${signal} signal`;
        const currentStep =
          statusManager?.currentStep || 'Workflow execution interrupted';
        statusManager?.pause(currentStep, output.error);
        console.log(
          colors.yellow(
            `\n⚠ Received ${signal} — saving checkpoint before exit...`
          )
        );
        const saved = saveCheckpoint(options.output, checkpointStore.getData());
        if (!saved) {
          console.warn(
            colors.yellow(
              '⚠ WARNING: Checkpoint could not be saved (no --output directory). Exiting as failed.'
            )
          );
        }
        // Collect agent-specific logs before exiting so diagnostics are
        // preserved even when the workflow is interrupted by a signal.
        if (logsDir) {
          collectAgentLogs(logsDir, options.agentTool);
        }
        // Log the pause event before exiting so it's captured in structured logs.
        logger?.info(
          'workflow_pause',
          output.error || 'Workflow paused by signal',
          {
            taskId: options.taskId,
            metadata: { signal },
          }
        );
        // IMPORTANT: process.exit() intentionally bypasses the normal cleanup
        // flow. The finally-block at the end of the step loop (acpRunner.close())
        // will NOT run. This is acceptable because:
        //   1. acpRunner.close() is called synchronously right here
        //   2. Signal handlers must exit quickly to avoid hanging
        //   3. Checkpoint data has already been saved above
        // If future cleanup is added to the finally block, ensure it is also
        // called here or converted to a process 'exit' event handler.
        acpRunner?.close();
        // Exit as PAUSED only if checkpoint was saved, otherwise exit as
        // FAILED so the CLI layer doesn't schedule a resume with no checkpoint.
        process.exit(saved ? EXIT_PAUSED : EXIT_FAILED);
      };
      sigtermHandler = () => gracefulShutdown('SIGTERM');
      sigintHandler = () => gracefulShutdown('SIGINT');
      process.on('SIGTERM', sigtermHandler);
      process.on('SIGINT', sigintHandler);

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
          const cached = getCachedStepResult(
            checkpointStore,
            step,
            stepsOutput
          );
          if (cached) return cached;

          return executeStep(step, {
            workflow: workflowManager,
            inputs,
            stepsOutput,
            defaultTool: tool,
            defaultModel: options.agentModel,
            statusManager,
            totalSteps,
            currentStepIndex: stepIndex,
            logger,
            output: options.output,
            acpRunner,
            checkpointStore,
          });
        },

        /**
         * Generic step executor for non-agent step types (command, loop).
         * Uses the unified executeStep dispatcher from step-executor.ts.
         * For agent sub-steps inside loops, passes acpRunner so they can
         * reuse the warm ACP connection instead of spawning subprocesses.
         */
        runStep: async (
          step: WorkflowStep,
          stepIndex: number,
          stepsOutput: Map<string, Map<string, string>>
        ): Promise<StepResult> => {
          // Checkpoint resume: skip completed steps
          const cached = getCachedStepResult(
            checkpointStore,
            step,
            stepsOutput
          );
          if (cached) return cached;

          return executeStep(step, {
            workflow: workflowManager,
            inputs,
            stepsOutput,
            defaultTool: tool,
            defaultModel: options.agentModel,
            statusManager,
            totalSteps,
            currentStepIndex: stepIndex,
            logger,
            output: options.output,
            acpRunner,
            checkpointStore,
          });
        },
      };

      const onStepComplete: OnStepComplete = (step, result, context) => {
        if (result.success && checkpointStore) {
          const completedSteps = checkpointStore.getData().completedSteps;
          upsertCompletedStep(
            completedSteps,
            step.id,
            Object.fromEntries(result.outputs.entries())
          );

          if (isLoopStep(step)) {
            for (const subStepId of step.steps.flatMap(
              (subStep: WorkflowStep) => collectNestedStepIds(subStep)
            )) {
              const subStepOutputs = context.stepsOutput.get(subStepId);
              if (!subStepOutputs) continue;
              upsertCompletedStep(
                completedSteps,
                subStepId,
                Object.fromEntries(subStepOutputs.entries())
              );
            }
          }

          checkpointStore.setCompletedSteps(completedSteps);
        }

        displayStepResults(step.name, result);
      };

      try {
        const runResult = await workflowManager.run(runner, onStepComplete);

        totalDuration = runResult.totalDuration;

        // Display workflow completion summary
        const successfulSteps = runResult.stepResults.filter(
          r => r.success
        ).length;
        const failedSteps = runResult.stepResults.filter(
          r => !r.success
        ).length;
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
        // Counts reflect top-level steps only; loop sub-step iterations
        // are not included in these totals.
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
          clearCheckpointFile(options.output);
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
      } catch (err) {
        if (err instanceof PauseWorkflowError) {
          // Already handled: output.paused is set, statusManager.pause() called
          output.success = false;
          output.error = err.message;
          output.paused = true;
          // Ensure checkpoint is persisted even if saveFailureSnapshot's
          // internal persist() failed earlier (it warns but continues).
          saveCheckpoint(options.output, checkpointStore.getData());
          logger?.info('workflow_pause', output.error, {
            taskId: options.taskId,
            metadata: { reason: 'retryable_error' },
          });
        } else {
          throw err;
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
    if (output.paused) {
      // Already handled by statusManager.pause() - don't overwrite with fail()
      if (!shutdownSignal) {
        console.log(colors.yellow(`\n⏸ ${output.error}`));
      }
    } else {
      statusManager?.fail(
        'Workflow execution',
        output.error || 'Unknown error'
      );
      logger?.error('workflow_fail', output.error || 'Unknown error', {
        taskId: options.taskId,
        error: output.error,
        duration: totalDuration,
      });

      console.log(colors.red(`\n✗ ${output.error}`));
    }
  }

  // Collect agent-specific logs into the logs directory
  if (logsDir) {
    collectAgentLogs(logsDir, options.agentTool);
  }

  if (sigtermHandler) {
    process.off('SIGTERM', sigtermHandler);
  }
  if (sigintHandler) {
    process.off('SIGINT', sigintHandler);
  }

  process.exit(
    output.success ? EXIT_SUCCESS : output.paused ? EXIT_PAUSED : EXIT_FAILED
  );
};
