/**
 * Workflow Store Manager
 * Manages the addition and storage of workflows in both local and central stores
 */

import { join } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { getConfigDir } from '../paths.js';
import { findProjectRoot } from '../project-root.js';
import { PROJECT_CONFIG_FILENAME } from 'rover-schemas';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

// Folder for workflows in central store
const WORKFLOWS_FOLDER = 'workflows';

/**
 * Error class for workflow store manager errors
 */
export class WorkflowStoreManagerError extends Error {
  constructor(
    message: string,
    public readonly reason?: unknown
  ) {
    super(message);
    this.name = 'WorkflowStoreManagerError';
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
  isLocal: boolean; // True if saved to local store, false if central
}

/**
 * Manager class for workflow stores (local and central)
 */
export class WorkflowStoreManager {
  private localStorePath: string | null;
  private centralStorePath: string;

  constructor() {
    // Check if we're in a Rover project
    const projectRoot = findProjectRoot();
    const isRoverProject = existsSync(
      join(projectRoot, PROJECT_CONFIG_FILENAME)
    );

    this.localStorePath = isRoverProject
      ? join(projectRoot, '.rover', WORKFLOWS_FOLDER)
      : null;

    this.centralStorePath = join(getConfigDir(), WORKFLOWS_FOLDER);

    // Ensure central store exists
    if (!existsSync(this.centralStorePath)) {
      mkdirSync(this.centralStorePath, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Get the appropriate store path (local if in a Rover project, otherwise central)
   */
  getStorePath(): string {
    if (this.localStorePath) {
      // Ensure local store exists
      if (!existsSync(this.localStorePath)) {
        mkdirSync(this.localStorePath, { recursive: true, mode: 0o700 });
      }
      return this.localStorePath;
    }
    return this.centralStorePath;
  }

  /**
   * Get the central store path
   */
  getCentralStorePath(): string {
    return this.centralStorePath;
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
   * Add a workflow from a URL or local path
   *
   * @param source URL or local path to the workflow
   * @param name Optional custom name for the workflow (without .yml extension)
   * @returns Information about the added workflow
   */
  async add(source: string, name?: string): Promise<AddWorkflowResult> {
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
        throw new WorkflowStoreManagerError(
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

    // Determine destination path
    const storePath = this.getStorePath();
    const fileName = `${workflowName}.yml`;
    const destPath = join(storePath, fileName);

    // Check for collision and warn
    if (existsSync(destPath)) {
      throw new WorkflowStoreManagerError(
        `Workflow "${workflowName}" already exists in the store. Use --name to specify a different name.`
      );
    }

    // Write the workflow file
    try {
      writeFileSync(destPath, contentWithFrontMatter, 'utf8');
    } catch (error) {
      throw new WorkflowStoreManagerError(
        `Failed to write workflow to ${destPath}`,
        error
      );
    }

    return {
      name: workflowName,
      path: destPath,
      isLocal: this.isInRoverProject(),
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
      throw new WorkflowStoreManagerError(
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
      throw new WorkflowStoreManagerError(
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
      throw new WorkflowStoreManagerError(`Invalid URL: ${url}`, error);
    }
  }

  /**
   * Extract workflow name from local path (filename without extension)
   */
  private extractNameFromPath(path: string): string {
    const fileName = path.split('/').pop() || path.split('\\').pop() || path;

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
