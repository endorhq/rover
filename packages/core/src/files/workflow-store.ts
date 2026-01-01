/**
 * Load workflows from folders. It acts as a central place to gather all
 * available workflows for the current context. It might use different folders
 * or even include individual workflow files.
 */
import { WorkflowManager } from './workflow.js';

export class WorkflowStore {
  private workflows: Map<string, WorkflowManager>;
  // TODO: In the future, we will add the concept of "sources".
  // The sources will be associated with a specific folder,
  // like "global", "project", or similar.
  //
  // This would be required once we allow users to define their own
  // workflows in their projects.
  // private sources: Map<string, string>;

  constructor() {
    this.workflows = new Map<string, WorkflowManager>();
  }

  /**
   * Add a workflow to the store
   *
   * @param workflow The WorkflowManager instance
   */
  addWorkflow(workflow: WorkflowManager): void {
    this.workflows.set(workflow.name, workflow);
  }

  /**
   * Load a workflow file and add it to the store
   *
   * @param path The file path to the workflow definition
   * @throws Error if the workflow cannot be loaded
   */
  loadWorkflow(path: string): void {
    const workflow = WorkflowManager.load(path);
    this.addWorkflow(workflow);
  }

  /**
   * Get a workflow by name
   * @param name The name of the workflow
   * @returns The WorkflowManager instance or undefined if not found
   */
  getWorkflow(name: string): WorkflowManager | undefined {
    return this.workflows.get(name);
  }

  /**
   * Get all workflows in the store
   * @returns An array of WorkflowManager instances
   */
  getAllWorkflows(): WorkflowManager[] {
    return Array.from(this.workflows.values());
  }
}
