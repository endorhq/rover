// Utilities to load and find workflows.
import {
  WorkflowManager,
  WorkflowStore,
  WorkflowSource,
  getConfigDir,
} from 'rover-core';
import { join } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import sweWorkflow from './workflows/swe.yml';
import sweTddWorkflow from './workflows/swe-tdd.yml';
import techWriterWorkflow from './workflows/tech-writer.yml';

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
 * Resolve bundled workflow assets against this module location.
 * tsdown may emit relative asset paths (e.g. ./swe-*.yml) at runtime.
 */
const resolveBuiltInWorkflowPath = (assetPath: string): string =>
  fileURLToPath(new URL(assetPath, import.meta.url));

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
  const swe = WorkflowManager.load(resolveBuiltInWorkflowPath(sweWorkflow));
  store.addWorkflow(swe, WorkflowSource.BuiltIn);

  const sweTdd = WorkflowManager.load(
    resolveBuiltInWorkflowPath(sweTddWorkflow)
  );
  store.addWorkflow(sweTdd, WorkflowSource.BuiltIn);

  const techWriter = WorkflowManager.load(
    resolveBuiltInWorkflowPath(techWriterWorkflow)
  );
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
