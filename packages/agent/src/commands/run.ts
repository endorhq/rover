import { CommandOutput } from '../cli.js';
import colors from 'ansi-colors';
import { AgentWorkflow } from '../workflow.js';
import { parseCollectOptions } from '../utils/options.js';

interface RunCommandOptions {
  // Inputs. Take precedence over files
  input: string[];
  // Load the inputs from a YAML file
  inputYaml?: string;
  // Load the inputs from a JSON file
  inputJson?: string;
}

interface RunCommandOutput extends CommandOutput {}

/**
 * Run a specific agent workflow file definition. It performs a set of validations
 * to confirm everything is ready and goes through the different steps.
 */
export const runCommand = async (
  workflowPath: string,
  options: RunCommandOptions
) => {
  const output: RunCommandOutput = {
    success: false,
  };

  try {
    // Load the agent workflow
    const agentWorkflow = AgentWorkflow.load(workflowPath);
    const inputs = parseCollectOptions(options.input);

    console.log(colors.white.bold('Running Agent Workflow'));
    console.log(colors.gray('├── Name: ') + colors.cyan(agentWorkflow.name));
    console.log(
      colors.gray('└── Description: ') + colors.white(agentWorkflow.description)
    );

    console.log(colors.white.bold('\nUser inputs'));
    const inputEntries = Array.from(inputs.entries());
    inputEntries.forEach(([key, value], idx) => {
      const prefix = idx == inputEntries.length - 1 ? '└──' : '├──';
      console.log(colors.white(`${prefix} ${key}=`) + colors.cyan(`${value}`));
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

      // TODO: CONTINUE

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
