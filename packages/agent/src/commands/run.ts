import { CommandOutput } from '../cli.js';
import colors from 'ansi-colors';
import { AgentWorkflow } from '../workflow.js';
import { parseCollectOptions } from '../lib/options.js';
import { Runner } from '../lib/runner.js';
import { IterationStatus } from 'rover-common';
import { existsSync, readFileSync } from 'node:fs';

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
}

interface RunCommandOutput extends CommandOutput {}

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
  let statusManager: IterationStatus | undefined;
  let totalDuration = 0;

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
        statusManager = IterationStatus.createInitial(
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
    const agentWorkflow = AgentWorkflow.load(workflowPath);
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
    for (const input of agentWorkflow.inputs) {
      if (!inputs.has(input.name) && input.default !== undefined) {
        inputs.set(input.name, String(input.default));
        defaultInputs.push(input.name);
      }
    }

    console.log(colors.bold('Agent Workflow'));
    console.log(colors.gray('├── Name: ') + colors.cyan(agentWorkflow.name));
    console.log(colors.gray('└── Description: ') + agentWorkflow.description);

    console.log(colors.bold('\nUser inputs'));
    const inputEntries = Array.from(inputs.entries());
    inputEntries.forEach(([key, value], idx) => {
      const prefix = idx == inputEntries.length - 1 ? '└──' : '├──';
      const isDefault = defaultInputs.includes(key);
      const suffix = isDefault ? colors.gray(' (default)') : '';
      console.log(`${prefix} ${key}=` + colors.cyan(`${value}`) + suffix);
    });

    // Validate inputs against workflow requirements
    const validation = agentWorkflow.validateInputs(inputs);

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
      agentWorkflow.steps.forEach((step, idx) => {
        const prefix = idx == agentWorkflow.steps.length - 1 ? '└──' : '├──';
        console.log(`${prefix} ${idx}. ` + `${step.name}`);
      });

      let runSteps = 0;
      const totalSteps = agentWorkflow.steps.length;

      for (
        let stepIndex = 0;
        stepIndex < agentWorkflow.steps.length;
        stepIndex++
      ) {
        const step = agentWorkflow.steps[stepIndex];
        const runner = new Runner(
          agentWorkflow,
          step.id,
          inputs,
          stepsOutput,
          options.agentTool,
          options.agentModel,
          statusManager,
          totalSteps,
          stepIndex
        );

        runSteps++;

        // Run it
        const result = await runner.run(options.output);

        // Display step results
        console.log(colors.bold(`\n📊 Step Results: ${step.name}`));
        console.log(colors.gray('├── ID: ') + colors.cyan(result.id));
        console.log(
          colors.gray('├── Status: ') +
            (result.success
              ? colors.green('✓ Success')
              : colors.red('✗ Failed'))
        );
        console.log(
          colors.gray('├── Duration: ') +
            colors.yellow(`${result.duration.toFixed(2)}s`)
        );
        totalDuration += result.duration;

        if (result.tokens) {
          console.log(
            colors.gray('├── Tokens: ') + colors.cyan(result.tokens.toString())
          );
        }
        if (result.cost) {
          console.log(
            colors.gray('├── Cost: ') +
              colors.cyan(`$${result.cost.toFixed(4)}`)
          );
        }
        if (result.error) {
          console.log(colors.gray('├── Error: ') + colors.red(result.error));
        }

        // Display outputs
        const outputEntries = Array.from(result.outputs.entries()).filter(
          ([key]) =>
            !key.startsWith('raw_') &&
            !key.startsWith('input_') &&
            key !== 'error'
        );

        if (outputEntries.length > 0) {
          console.log(colors.gray('└── Outputs:'));
          outputEntries.forEach(([key, value], idx) => {
            const prefix =
              idx === outputEntries.length - 1 ? '    └──' : '    ├──';
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

        // Store step outputs for next steps to use
        if (result.success) {
          stepsOutput.set(step.id, result.outputs);
        } else {
          // If step failed, decide whether to continue based on workflow config
          const continueOnError =
            agentWorkflow.config?.continueOnError || false;
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

      // Display workflow completion summary
      console.log(colors.bold('\n🎉 Workflow Execution Summary'));
      console.log(
        colors.gray('├── Duration: ') +
          colors.cyan(totalDuration.toFixed(2) + 's')
      );
      console.log(
        colors.gray('├── Total Steps: ') +
          colors.cyan(agentWorkflow.steps.length.toString())
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

      const skippedSteps = agentWorkflow.steps.length - runSteps;
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
      output.success = true;
      statusManager?.complete('Workflow completed successfully');
    }
  } catch (err) {
    output.success = false;
    output.error = err instanceof Error ? err.message : `${err}`;
  }

  if (!output.success) {
    statusManager?.fail('Workflow execution', output.error || 'Unknown error');

    console.log(colors.red(`\n✗ ${output.error}`));
  }
};
