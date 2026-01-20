// Utilities to load and find workflows.
import {
  WorkflowManager,
  WorkflowStore,
  WorkflowSource,
  getConfigDir,
} from 'rover-core';
import sweWorkflow from './workflows/swe.yml';
import techWriterWorkflow from './workflows/tech-writer.yml';
import { dirname, isAbsolute, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, statSync } from 'fs';

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
 * Scan a directory for workflow YAML files
 *
 * @param dir Directory to scan
 * @returns Array of absolute file paths to workflow files
 */
const scanWorkflowDirectory = (dir: string): string[] => {
  if (!existsSync(dir)) {
    return [];
  }

  const workflows: string[] = [];

  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (
        stat.isFile() &&
        (entry.endsWith('.yml') || entry.endsWith('.yaml'))
      ) {
        workflows.push(fullPath);
      }
    }
  } catch (error) {
    // Silently ignore errors (e.g., permission issues)
  }

  return workflows;
};

/**
 * Load all the available workflows from multiple sources:
 * - Built-in workflows (swe, tech-writer)
 * - Global workflows (~/.rover/config/workflows/)
 * - Project workflows (<project>/.rover/workflows/)
 *
 * @param projectPath - Optional project root path. If provided, loads project workflows.
 * @returns A WorkflowStore containing all loaded workflows
 */
export const initWorkflowStore = (projectPath?: string): WorkflowStore => {
  const store = new WorkflowStore(projectPath);

  // Load built-in workflows
  const swe = loadBuiltInWorkflow(sweWorkflow);
  store.addWorkflow(swe, WorkflowSource.BuiltIn);

  const techWriter = loadBuiltInWorkflow(techWriterWorkflow);
  store.addWorkflow(techWriter, WorkflowSource.BuiltIn);

  // Load global workflows from ~/.rover/config/workflows/
  const globalWorkflowsDir = join(getConfigDir(), 'workflows');
  const globalWorkflows = scanWorkflowDirectory(globalWorkflowsDir);

  for (const workflowPath of globalWorkflows) {
    try {
      store.loadWorkflow(workflowPath, WorkflowSource.Global);
    } catch (error) {
      // Skip invalid workflow files
      console.warn(
        `Warning: Failed to load global workflow from ${workflowPath}: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  // Load project workflows from <project>/.rover/workflows/ if projectPath is provided
  if (projectPath) {
    const projectWorkflowsDir = join(projectPath, '.rover', 'workflows');
    const projectWorkflows = scanWorkflowDirectory(projectWorkflowsDir);

    for (const workflowPath of projectWorkflows) {
      try {
        store.loadWorkflow(workflowPath, WorkflowSource.Project);
      } catch (error) {
        // Skip invalid workflow files
        console.warn(
          `Warning: Failed to load project workflow from ${workflowPath}: ${error instanceof Error ? error.message : error}`
        );
      }
    }
  }

  return store;
};
