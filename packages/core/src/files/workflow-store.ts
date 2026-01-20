/**
 * Load workflows from folders. It acts as a global place to gather all
 * available workflows for the current context. It might use different folders
 * or even include individual workflow files.
 *
 * Also handles workflow persistence and addition to local and global stores.
 */
import { join, basename } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { WorkflowManager } from './workflow.js';
import { getConfigDir } from '../paths.js';
import { PROJECT_CONFIG_FILENAME } from 'rover-schemas';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

// Folder for workflows in global store
const WORKFLOWS_FOLDER = 'workflows';

/**
 * Error class for workflow store errors
 */
export class WorkflowStoreError extends Error {
  constructor(
    message: string,
    public readonly reason?: unknown
  ) {
    super(message);
    this.name = 'WorkflowStoreError';
  }
}

/**
 * Metadata for workflow front matter
 */
export interface WorkflowMetadata {
  source: string; // URL or local path
  importedAt: string; // ISO timestamp
  checksum: string; // SHA256 hash of original content
}

/**
 * Result of adding a workflow
 */
export interface AddWorkflowResult {
  name: string; // Name of the workflow (may be renamed)
  path: string; // Absolute path where the workflow was saved
  isLocal: boolean; // True if saved to local store, false if global
}

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
  private localStorePath: string | null;
  private globalStorePath: string;

  /**
   * Create a new WorkflowStore
   * @param projectPath - Optional project root path. If provided and contains rover.json,
   *                      enables local workflow storage at <projectPath>/.rover/workflows/
   */
  constructor(projectPath?: string) {
    this.workflows = new Map<string, WorkflowEntry>();

    // Check if we're in a Rover project (only if projectPath is provided)
    const isRoverProject = projectPath
      ? existsSync(join(projectPath, PROJECT_CONFIG_FILENAME))
      : false;

    this.localStorePath =
      isRoverProject && projectPath
        ? join(projectPath, '.rover', WORKFLOWS_FOLDER)
        : null;

    this.globalStorePath = join(getConfigDir(), WORKFLOWS_FOLDER);

    // Ensure global store exists
    if (!existsSync(this.globalStorePath)) {
      mkdirSync(this.globalStorePath, { recursive: true, mode: 0o700 });
    }
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

  /**
   * Get the appropriate store path (local if in a Rover project, otherwise global)
   */
  getStorePath(): string {
    if (this.localStorePath) {
      // Ensure local store exists
      if (!existsSync(this.localStorePath)) {
        mkdirSync(this.localStorePath, { recursive: true, mode: 0o700 });
      }
      return this.localStorePath;
    }
    return this.globalStorePath;
  }

  /**
   * Get the global store path
   */
  getGlobalStorePath(): string {
    return this.globalStorePath;
  }

  /**
   * Get the local store path (null if not in a Rover project)
   */
  getLocalStorePath(): string | null {
    return this.localStorePath;
  }

  /**
   * Check if we're in a Rover project (i.e., local store is available)
   */
  isInRoverProject(): boolean {
    return this.localStorePath !== null;
  }

  /**
   * Save a workflow from a URL or local path to the store
   *
   * @param source URL or local path to the workflow
   * @param name Optional custom name for the workflow (without .yml extension)
   * @param forceGlobal If true, save to global store even when in a project
   * @returns Information about the saved workflow
   */
  async saveWorkflow(
    source: string,
    name?: string,
    forceGlobal?: boolean
  ): Promise<AddWorkflowResult> {
    let content: string;
    let workflowName: string;

    // Determine if source is a URL or local path
    if (source.startsWith('http://') || source.startsWith('https://')) {
      // Fetch from URL
      content = await this.fetchFromURL(source);
      workflowName = name || this.extractNameFromURL(source);
    } else {
      // Read from local path
      content = this.readFromPath(source);
      workflowName = name || this.extractNameFromPath(source);
    }

    // If a custom name is provided, update the workflow's internal name field
    if (name) {
      try {
        const workflowData = parseYaml(content);
        if (
          workflowData &&
          typeof workflowData === 'object' &&
          'name' in workflowData
        ) {
          workflowData.name = name;
          content = stringifyYaml(workflowData, {
            indent: 2,
            lineWidth: 80,
            minContentWidth: 20,
          });
        }
      } catch (error) {
        throw new WorkflowStoreError(
          `Failed to parse workflow content for name update`,
          error
        );
      }
    }

    // Calculate checksum of original content
    const checksum = this.calculateChecksum(content);

    // Add front matter
    const metadata: WorkflowMetadata = {
      source,
      importedAt: new Date().toISOString(),
      checksum,
    };
    const contentWithFrontMatter = this.addFrontMatter(content, metadata);

    // Determine destination path (use global store if forceGlobal is set)
    const storePath = forceGlobal ? this.globalStorePath : this.getStorePath();
    const fileName = `${workflowName}.yml`;
    const destPath = join(storePath, fileName);

    // Check for collision and warn
    if (existsSync(destPath)) {
      throw new WorkflowStoreError(
        `Workflow "${workflowName}" already exists in the store. Use --name to specify a different name.`
      );
    }

    // Write the workflow file
    try {
      writeFileSync(destPath, contentWithFrontMatter, 'utf8');
    } catch (error) {
      throw new WorkflowStoreError(
        `Failed to write workflow to ${destPath}`,
        error
      );
    }

    return {
      name: workflowName,
      path: destPath,
      isLocal: forceGlobal ? false : this.isInRoverProject(),
    };
  }

  /**
   * Fetch workflow content from HTTP(S) URL
   */
  private async fetchFromURL(url: string): Promise<string> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.text();
    } catch (error) {
      throw new WorkflowStoreError(
        `Failed to fetch workflow from ${url}`,
        error
      );
    }
  }

  /**
   * Read workflow content from local path
   */
  private readFromPath(path: string): string {
    try {
      if (!existsSync(path)) {
        throw new Error(`File not found: ${path}`);
      }
      return readFileSync(path, 'utf8');
    } catch (error) {
      throw new WorkflowStoreError(
        `Failed to read workflow from ${path}`,
        error
      );
    }
  }

  /**
   * Extract workflow name from URL (last segment without extension)
   */
  private extractNameFromURL(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const segments = pathname.split('/').filter(s => s.length > 0);
      const lastSegment = segments[segments.length - 1];

      // Remove .yml or .yaml extension if present
      return lastSegment.replace(/\.(yml|yaml)$/i, '');
    } catch (error) {
      throw new WorkflowStoreError(`Invalid URL: ${url}`, error);
    }
  }

  /**
   * Extract workflow name from local path (filename without extension)
   */
  private extractNameFromPath(path: string): string {
    const fileName = basename(path);

    // Remove .yml or .yaml extension if present
    return fileName.replace(/\.(yml|yaml)$/i, '');
  }

  /**
   * Calculate SHA256 checksum of content
   */
  private calculateChecksum(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Add front matter to workflow YAML content
   */
  private addFrontMatter(content: string, metadata: WorkflowMetadata): string {
    const frontMatter = [
      '# Rover Workflow Metadata',
      `# Source: ${metadata.source}`,
      `# Imported At: ${metadata.importedAt}`,
      `# Original Checksum: ${metadata.checksum}`,
      '#',
      '',
    ].join('\n');

    return frontMatter + content;
  }

  /**
   * Parse front matter from workflow content
   * Returns metadata and content without front matter
   */
  static parseFrontMatter(content: string): {
    metadata: WorkflowMetadata | null;
    content: string;
  } {
    const lines = content.split('\n');
    const metadata: Partial<WorkflowMetadata> = {};
    let contentStartIndex = 0;

    // Look for Rover Workflow Metadata header
    if (lines[0]?.trim() === '# Rover Workflow Metadata') {
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];

        // End of front matter
        if (!line.startsWith('#')) {
          contentStartIndex = i;
          break;
        }

        // Parse metadata fields
        const sourceMatch = line.match(/^# Source: (.+)$/);
        if (sourceMatch) {
          metadata.source = sourceMatch[1];
        }

        const importedMatch = line.match(/^# Imported At: (.+)$/);
        if (importedMatch) {
          metadata.importedAt = importedMatch[1];
        }

        const checksumMatch = line.match(/^# Original Checksum: (.+)$/);
        if (checksumMatch) {
          metadata.checksum = checksumMatch[1];
        }
      }
    }

    const hasMetadata =
      metadata.source && metadata.importedAt && metadata.checksum;

    return {
      metadata: hasMetadata ? (metadata as WorkflowMetadata) : null,
      content: lines.slice(contentStartIndex).join('\n'),
    };
  }
}
