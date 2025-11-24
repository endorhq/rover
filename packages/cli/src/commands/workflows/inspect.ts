/**
 * Inspect a specific workflow by name showing detailed information.
 */
import colors from 'ansi-colors';
import { initWorkflowStore } from '../../lib/workflow.js';
import {
  showTitle,
  showProperties,
  showDiagram,
  type DiagramStep,
} from 'rover-common';
import type { WorkflowOutput } from 'rover-schemas';
import { readFileSync } from 'node:fs';
import { getTelemetry } from '../../lib/telemetry.js';
import { isJsonMode, setJsonMode } from '../../lib/global-state.js';

interface InspectWorkflowCommandOptions {
  // Output formats
  json: boolean;
  raw: boolean;
}

/**
 * Inspect a specific workflow showing detailed information.
 *
 * @param workflowName Name of the workflow to inspect
 * @param options Options to modify the output
 */
export const inspectWorkflowCommand = async (
  workflowName: string,
  options: InspectWorkflowCommandOptions
) => {
  const telemetry = getTelemetry();
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

  try {
    // Track inspect workflow event
    telemetry?.eventInspectWorkflow();

    // Load the workflow
    const workflowStore = initWorkflowStore();
    const workflow = workflowStore.getWorkflow(workflowName);

    if (!workflow) {
      if (isJsonMode()) {
        console.log(
          JSON.stringify(
            {
              success: false,
              error: `Workflow "${workflowName}" not found`,
            },
            null,
            2
          )
        );
      } else if (options.raw) {
        console.error(`Error: Workflow "${workflowName}" not found`);
      } else {
        console.log(colors.red(`✗ Workflow "${workflowName}" not found`));
        console.log(
          colors.gray('\nUse ') +
            colors.cyan('rover workflows list') +
            colors.gray(' to see available workflows')
        );
      }
      return;
    }

    // Handle --raw flag: output workflow as YAML
    if (options.raw) {
      // Read the file directly. There's an issue with the toYaml method.
      // It adds extra breaklines in the prompts.
      // @see https://github.com/eemeli/yaml/issues/639#issuecomment-3381575231
      console.log(readFileSync(workflow.filePath, 'utf-8'));
      return;
    }

    // Handle --json flag: output workflow as JSON
    if (isJsonMode()) {
      console.log(
        JSON.stringify(
          {
            success: true,
            workflow: workflow.toObject(),
          },
          null,
          2
        )
      );
      return;
    }

    // Regular output mode: formatted display
    showTitle('Workflow Details');

    // Display basic metadata
    const properties: Record<string, string> = {
      Name: workflow.name,
      Description: workflow.description || colors.gray('No description'),
      Version: workflow.version,
    };

    // Add defaults if present
    if (workflow.defaults) {
      if (workflow.defaults.tool) {
        properties['Default Tool'] = workflow.defaults.tool;
      }
      if (workflow.defaults.model) {
        properties['Default Model'] = workflow.defaults.model;
      }
    }

    // Add config if present
    if (workflow.config) {
      if (workflow.config.timeout) {
        properties['Timeout'] = `${workflow.config.timeout}s`;
      }
      if (workflow.config.continueOnError !== undefined) {
        properties['Continue On Error'] = workflow.config.continueOnError
          ? 'Yes'
          : 'No';
      }
    }

    showProperties(properties);

    // Display inputs
    if (workflow.inputs.length > 0) {
      showTitle('Inputs');
      const inputProperties: Record<string, string> = {};
      workflow.inputs.forEach(input => {
        const parts: string[] = [];

        if (input.description) {
          parts.push(input.description);
        }

        const details: string[] = [];
        if (input.required) {
          details.push(colors.red('required'));
        }
        if (input.default) {
          details.push(colors.gray(`default: ${input.default}`));
        }

        if (details.length > 0) {
          parts.push(`(${details.join(', ')})`);
        }

        inputProperties[input.name] =
          parts.join(' ') || colors.gray('No description');
      });
      showProperties(inputProperties);
    }

    // Display outputs
    if (workflow.outputs.length > 0) {
      showTitle('Outputs');
      const outputProperties: Record<string, string> = {};
      workflow.outputs.forEach(output => {
        outputProperties[output.name] =
          output.description || colors.gray('No description');
      });
      showProperties(outputProperties);
    }

    // Display steps as a visual diagram
    if (workflow.steps.length > 0) {
      showTitle('Steps');

      const diagramSteps: DiagramStep[] = workflow.steps.map(step => {
        const items: string[] = [];

        // Add outputs if present
        if (step.outputs && step.outputs.length > 0) {
          step.outputs.forEach((output: WorkflowOutput) => {
            items.push(`${colors.cyan('→')} ${output.name}`);
          });
        }

        return {
          title: step.name,
          items,
        };
      });

      showDiagram(diagramSteps, { addLineBreak: false });
    }
  } catch (error) {
    if (isJsonMode()) {
      console.log(
        JSON.stringify(
          {
            success: false,
            error: `Error inspecting workflow: ${error}`,
          },
          null,
          2
        )
      );
    } else if (options.raw) {
      console.error(`Error inspecting workflow: ${error}`);
    } else {
      console.error(colors.red('Error inspecting workflow:'), error);
    }
  } finally {
    await telemetry?.shutdown();
  }
};
