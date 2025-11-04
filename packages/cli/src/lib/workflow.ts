// Utilities to load and find workflows.
import { WorkflowManager, WorkflowStore } from 'rover-schemas';
import sweWorkflow from './workflows/swe.yml';
import techWriterWorkflow from './workflows/tech-writer.yml';
import { dirname, isAbsolute, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Load a workflow from a built-in path.
 *
 * @param path the file path pointing to the workflow YAML file
 * @returns WorkflowManager instance
 */
const loadBuiltInWorkflow = (path: string): WorkflowManager => {
  const distDir = dirname(fileURLToPath(import.meta.url));
  const workflowPath = isAbsolute(path) ? path : join(distDir, path);
  return WorkflowManager.load(workflowPath);
};

/**
 * Load all the available workflows. Currently, it
 * only includes the built-in workflows.
 *
 * @returns A WorkflowStore containing all loaded workflows
 */
export const initWorkflowStore = (): WorkflowStore => {
  const store = new WorkflowStore();

  const swe = loadBuiltInWorkflow(sweWorkflow);
  store.addWorkflow(swe);

  const techWriter = loadBuiltInWorkflow(techWriterWorkflow);
  store.addWorkflow(techWriter);

  return store;
};
