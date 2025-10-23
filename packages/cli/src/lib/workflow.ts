// Utilities to load and find workflows.
import { WorkflowManager } from 'rover-schemas';
import sweWorkflow from './workflows/swe.yml';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Load a workflow based on the given name
 */
export const loadWorkflowByName = (
  name: string
): WorkflowManager | undefined => {
  switch (name) {
    case 'swe': {
      const distDir = dirname(fileURLToPath(import.meta.url));
      const workflowPath = join(distDir, sweWorkflow);

      const workflow = WorkflowManager.load(workflowPath);
      return workflow;
    }
  }
};
