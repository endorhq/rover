// Utilities to load and find workflows.
import { WorkflowManager } from 'rover-schemas';
import sweWorkflow from './workflows/swe.yml';
import techWriterWorkflow from './workflows/tech-writer.yml';
import { dirname, isAbsolute, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Load a workflow based on the given name
 */
export const loadWorkflowByName = (
  name: string
): WorkflowManager | undefined => {
  const distDir = dirname(fileURLToPath(import.meta.url));
  let workflowPath;

  switch (name) {
    case 'swe': {
      workflowPath = isAbsolute(sweWorkflow)
        ? sweWorkflow
        : join(distDir, sweWorkflow);
      break;
    }
    case 'tech-writer': {
      workflowPath = isAbsolute(techWriterWorkflow)
        ? techWriterWorkflow
        : join(distDir, techWriterWorkflow);
      break;
    }
  }

  if (workflowPath != null) {
    const workflow = WorkflowManager.load(workflowPath);
    return workflow;
  }

  return undefined;
};
