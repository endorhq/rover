/**
 * Load workflows from folders. It acts as a central place to gather all
 * available workflows for the current context. It might use different folders
 * or even include individual workflow files.
 */
import { WorkflowManager } from './workflow.js';

/**
 * Source of a workflow
 */
export enum WorkflowSource {
  BuiltIn = 'built-in',
  Global = 'global',
  Project = 'project',
}

/**
 * Workflow entry with source information
 */
export interface WorkflowEntry {
  workflow: WorkflowManager;
  source: WorkflowSource;
}

export class WorkflowStore {
  private workflows: Map<string, WorkflowEntry>;

  constructor() {
    this.workflows = new Map<string, WorkflowEntry>();
  }

  /**
   * Add a workflow to the store
   *
   * @param workflow The WorkflowManager instance
   * @param source The source of the workflow
   */
  addWorkflow(workflow: WorkflowManager, source: WorkflowSource): void {
    this.workflows.set(workflow.name, { workflow, source });
  }

  /**
   * Load a workflow file and add it to the store
   *
   * @param path The file path to the workflow definition
   * @param source The source of the workflow
   * @throws Error if the workflow cannot be loaded
   */
  loadWorkflow(path: string, source: WorkflowSource): void {
    const workflow = WorkflowManager.load(path);
    this.addWorkflow(workflow, source);
  }

  /**
   * Get a workflow by name
   * @param name The name of the workflow
   * @returns The WorkflowManager instance or undefined if not found
   */
  getWorkflow(name: string): WorkflowManager | undefined {
    return this.workflows.get(name)?.workflow;
  }

  /**
   * Get a workflow entry (with source) by name
   * @param name The name of the workflow
   * @returns The WorkflowEntry or undefined if not found
   */
  getWorkflowEntry(name: string): WorkflowEntry | undefined {
    return this.workflows.get(name);
  }

  /**
   * Get all workflows in the store
   * @returns An array of WorkflowManager instances
   */
  getAllWorkflows(): WorkflowManager[] {
    return Array.from(this.workflows.values()).map(entry => entry.workflow);
  }

  /**
   * Get all workflow entries with source information
   * @returns An array of WorkflowEntry instances
   */
  getAllWorkflowEntries(): WorkflowEntry[] {
    return Array.from(this.workflows.values());
  }
}
