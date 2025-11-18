/**
 * List the different workflows available.
 */
import colors from 'ansi-colors';
import { initWorkflowStore } from '../../lib/workflow.js';
import { Table, TableColumn } from 'rover-common';
import { CLIJsonOutput } from '../../types.js';
import { exitWithError, exitWithSuccess } from '../../utils/exit.js';
import { Workflow } from 'rover-schemas';
import { getTelemetry } from '../../lib/telemetry.js';
import { isJsonMode, setJsonMode } from '../../lib/global-state.js';

interface ListWorkflowsCommandOptions {
  // Output format
  json: boolean;
}

/**
 * Interface for JSON output
 */
interface ListWorkflowsOutput extends CLIJsonOutput {
  workflows: Workflow[];
}

/**
 * Row data for the table
 */
interface WorkflowRow {
  name: string;
  description: string;
  steps: string;
  inputs: string;
}

/**
 * List the available workflows.
 *
 * @param options Options to modify the output
 */
export const listWorkflowsCommand = async (
  options: ListWorkflowsCommandOptions
) => {
  const telemetry = getTelemetry();
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

  const workflowStore = initWorkflowStore();
  const output: ListWorkflowsOutput = {
    success: false,
    workflows: [],
  };

  try {
    // Track list workflows event
    telemetry?.eventListWorkflows();
    if (isJsonMode()) {
      // For the JSON, add some extra information.
      output.success = true;
      output.workflows = workflowStore
        .getAllWorkflows()
        .map(wf => wf.toObject());

      await exitWithSuccess('', output, { telemetry });
    } else {
      // Define table columns
      const columns: TableColumn<WorkflowRow>[] = [
        {
          header: 'Name',
          key: 'name',
          minWidth: 12,
          maxWidth: 30,
          truncate: 'ellipsis',
        },
        {
          header: 'Description',
          key: 'description',
          minWidth: 15,
          maxWidth: 50,
          truncate: 'ellipsis',
          format: (value: string) => colors.gray(value),
        },
        {
          header: 'Steps',
          key: 'steps',
          maxWidth: 3,
        },
        {
          header: 'Inputs',
          key: 'inputs',
          minWidth: 8,
          maxWidth: 50,
          truncate: 'ellipsis',
        },
      ];

      const rows: WorkflowRow[] = workflowStore.getAllWorkflows().map(wf => {
        return {
          name: wf.name,
          description: wf.description || '',
          steps: wf.steps.length.toString(),
          inputs: wf.inputs ? wf.inputs.map(i => i.name).join(', ') : 'None',
        };
      });

      // Render the table
      const table = new Table(columns);
      table.render(rows);

      // No exit with success since we already printed the table
    }
  } catch (error) {
    output.error = 'Error loading the workflows.';
    await exitWithError(output, { telemetry });
  } finally {
    await telemetry?.shutdown();
  }
};
