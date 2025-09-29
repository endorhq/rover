import { CommandOutput } from '../cli.js';
import colors from 'ansi-colors';
import { AgentWorkflow } from '../workflow.js';
import { parseCollectOptions } from '../lib/options.js';
import { Runner } from '../lib/runner.js';

interface RunCommandOptions {
  // Inputs. Take precedence over files
  input: string[];
  // Load the inputs from a YAML file
  inputYaml?: string;
  // Load the inputs from a JSON file
  inputJson?: string;
  // Tool to use instead of workflow defaults
  agentTool?: string;
  // Model to use instead of workflow defaults
  agentModel?: string;
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

  try {
    // Load the agent workflow
    const agentWorkflow = AgentWorkflow.load(workflowPath);
    const providedInputs = parseCollectOptions(options.input);

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

    console.log(colors.white.bold('Agent Workflow'));
    console.log(colors.gray('├── Name: ') + colors.cyan(agentWorkflow.name));
    console.log(
      colors.gray('└── Description: ') + colors.white(agentWorkflow.description)
    );

    console.log(colors.white.bold('\nUser inputs'));
    const inputEntries = Array.from(inputs.entries());
    inputEntries.forEach(([key, value], idx) => {
      const prefix = idx == inputEntries.length - 1 ? '└──' : '├──';
      const isDefault = defaultInputs.includes(key);
      const suffix = isDefault ? colors.gray(' (default)') : '';
      console.log(
        colors.white(`${prefix} ${key}=`) + colors.cyan(`${value}`) + suffix
      );
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
      console.log(colors.white.bold('\nSteps'));
      agentWorkflow.steps.forEach((step, idx) => {
        const prefix = idx == agentWorkflow.steps.length - 1 ? '└──' : '├──';
        console.log(
          colors.white(`${prefix} ${idx}. `) + colors.white(`${step.name}`)
        );
      });

      let runSteps = 0;

      for (const step of agentWorkflow.steps) {
        const runner = new Runner(
          agentWorkflow,
          step.id,
          inputs,
          stepsOutput,
          options.agentTool,
          options.agentModel
        );

        runSteps++;

        // Run it
        const result = await runner.run();

        // Display step results
        console.log(colors.white.bold(`\n📊 Step Results: ${step.name}`));
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
            const displayValue =
              value.length > 100 ? value.substring(0, 100) + '...' : value;
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
      console.log(colors.white.bold('\n🎉 Workflow Execution Summary'));
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

      output.success = true;
    }
  } catch (err) {
    output.success = false;
    output.error = err instanceof Error ? err.message : `${err}`;
  }

  if (!output.success) {
    console.log(colors.red(`\n✗ ${output.error}`));
  }
};
