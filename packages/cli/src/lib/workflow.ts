// Utilities to load and find workflows.
import { WorkflowManager } from 'rover-schemas';
import sweWorkflow from './workflows/swe.yml';
import techWriterWorkflow from './workflows/tech-writer.yml';
import { dirname, join } from 'path';
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
      workflowPath = join(distDir, sweWorkflow);
    }
    case 'tech-writer': {
      workflowPath = join(distDir, techWriterWorkflow);
    }
  }

  if (workflowPath != null) {
    const workflow = WorkflowManager.load(workflowPath);
    return workflow;
  }
};
