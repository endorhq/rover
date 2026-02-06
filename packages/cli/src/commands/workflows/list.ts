/**
 * List the different workflows available.
 */
import colors from 'ansi-colors';
import { initWorkflowStore } from '../../lib/workflow.js';
import { Table, TableColumn, WorkflowSource } from 'rover-core';
import type { ListWorkflowsOutput } from '../../output-types.js';
import { exitWithError, exitWithSuccess } from '../../utils/exit.js';
import { getTelemetry } from '../../lib/telemetry.js';
import { getProjectPath, isJsonMode, setJsonMode } from '../../lib/context.js';
import type { CommandDefinition } from '../../types.js';

interface ListWorkflowsCommandOptions {
  // Output format
  json: boolean;
}

/**
 * Row data for the table
 */
interface WorkflowRow {
  name: string;
  description: string;
  steps: string;
  inputs: string;
  source: string;
}

/**
 * List the available workflows.
 *
 * @param options Options to modify the output
 */
const listWorkflowsCommand = async (options: ListWorkflowsCommandOptions) => {
  const telemetry = getTelemetry();
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

  const workflowStore = initWorkflowStore(getProjectPath() ?? process.cwd());
  const output: ListWorkflowsOutput = {
    success: false,
    workflows: [],
  };

  try {
    // Track list workflows event
    telemetry?.eventListWorkflows();
    if (isJsonMode()) {
      // For the JSON, add some extra information including source.
      output.success = true;
      output.workflows = workflowStore.getAllWorkflowEntries().map(entry => ({
        ...entry.workflow.toObject(),
        source: entry.source,
      }));

      await exitWithSuccess(null, output, { telemetry });
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
          maxWidth: 30,
          truncate: 'ellipsis',
        },
        {
          header: 'Source',
          key: 'source',
          minWidth: 8,
          maxWidth: 10,
        },
      ];

      const rows: WorkflowRow[] = workflowStore
        .getAllWorkflowEntries()
        .map(entry => {
          const wf = entry.workflow;
          return {
            name: wf.name,
            description: wf.description || '',
            steps: wf.steps.length.toString(),
            inputs: wf.inputs ? wf.inputs.map(i => i.name).join(', ') : 'None',
            source: entry.source,
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

export default {
  name: 'list',
  parent: 'workflows',
  description: 'List all available workflows',
  requireProject: false,
  action: listWorkflowsCommand,
} satisfies CommandDefinition;
