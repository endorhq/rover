/**
 * List the different workflows available.
 */
import { WorkflowManager, WorkflowStore } from 'rover-schemas';
import { initWorkflowStore } from '../../lib/workflow.js';

interface ListWorkflowsCommandOptions {
  // Output format
  json: boolean;
}

/**
 * List the available workflows.
 *
 * @param options Options to modify the output
 */
export const listWorkflowsCommand = async (
  options: ListWorkflowsCommandOptions
) => {
  const workflowStore = initWorkflowStore();

  console.log(workflowStore.getAllWorkflows());
};
