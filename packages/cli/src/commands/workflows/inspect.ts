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
import { WorkflowManager } from 'rover-schemas';

interface InspectWorkflowCommandOptions {
  // Output formats
  json: boolean;
  raw: boolean;
}

/**
 * Load a workflow by name from the workflow store.
 *
 * @param name The name of the workflow to load
 * @returns WorkflowManager instance or undefined if not found
 */
const loadWorkflowByName = (name: string): WorkflowManager | undefined => {
  const workflowStore = initWorkflowStore();
  return workflowStore.getWorkflow(name);
};

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
  try {
    // Load the workflow
    const workflow = loadWorkflowByName(workflowName);

    if (!workflow) {
      if (options.json) {
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
      console.log(workflow.toYaml());
      return;
    }

    // Handle --json flag: output workflow as JSON
    if (options.json) {
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

        inputProperties[input.name] = parts.join(' ') || colors.gray('No description');
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

        // Add description if present
        if (step.description) {
          items.push(colors.gray(`• ${step.description}`));
        }

        // Add step type info
        items.push(colors.gray(`• Type: ${step.type}`));

        // Add step ID
        items.push(colors.gray(`• ID: ${step.id}`));

        // Add outputs if present
        if (step.outputs && step.outputs.length > 0) {
          items.push(
            colors.gray(`• Outputs: ${step.outputs.map(o => o.name).join(', ')}`)
          );
        }

        return {
          title: step.name,
          items,
        };
      });

      showDiagram(diagramSteps, { addLineBreak: true });
    }
  } catch (error) {
    if (options.json) {
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
  }
};
