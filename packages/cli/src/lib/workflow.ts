// Utilities to load and find workflows.
import { loadWorkflow, type Workflow } from 'rover-common';
import sweWorkflow from './workflows/swe.yml';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Load a workflow based on the given name
 */
export const loadWorkflowByName = (name: string): Workflow | undefined => {
  switch (name) {
    case 'swe': {
      const distDir = dirname(fileURLToPath(import.meta.url));
      const workflowPath = join(distDir, sweWorkflow);

      const workflow = loadWorkflow(workflowPath) as Workflow;
      return workflow;
    }
  }
};
