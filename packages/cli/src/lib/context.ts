/**
 * CLI Context for execution.
 * This module provides a cohesive context object for CLI state management.
 */

import path from 'node:path';
import { type ProjectManager, ProjectStore } from 'rover-core';

/**
 * CLI execution context
 */
export interface CLIContext {
  /** JSON output mode */
  jsonMode: boolean;

  /** Verbose logging */
  verbose: boolean;

  /** Default project from cwd (null = global mode) */
  project: ProjectManager | null;

  /** Whether cwd is inside a git repository */
  inGitRepo: boolean;

  /** Value from --project flag or ROVER_PROJECT env variable (for later resolution) */
  projectOption?: string;
}

let _context: CLIContext | null = null;

/**
 * Initialize the CLI context.
 * This should be called early in program execution (e.g., in preAction hooks).
 */
export function initCLIContext(ctx: CLIContext): void {
  _context = ctx;
}

/**
 * Get the current CLI context.
 * @throws If context has not been initialized
 */
export function getCLIContext(): CLIContext {
  if (!_context) {
    throw new Error('CLI context not initialized. This is a bug.');
  }
  return _context;
}

/**
 * Reset the CLI context (for testing).
 */
export function resetCLIContext(): void {
  _context = null;
}

// Convenience accessors

/**
 * Check if the CLI is running in JSON output mode.
 * When in JSON mode, human-readable console output should be suppressed.
 */
export function isJsonMode(): boolean {
  return getCLIContext().jsonMode;
}

/**
 * Check if the CLI is running in Verbose mode.
 * When in JSON mode, human-readable console output should be suppressed.
 */
export function isVerbose(): boolean {
  return getCLIContext().verbose;
}

/**
 * Set JSON mode.
 */
export function setJsonMode(value: boolean): void {
  getCLIContext().jsonMode = value;
}

/**
 * Check if the CLI is in project mode (vs global mode).
 */
export function isProjectMode(): boolean {
  return getCLIContext().project !== null;
}

/**
 * Sets the default project in context.
 * @param project ProjectManager instance
 */
export function setProject(project: ProjectManager): void {
  getCLIContext().project = project;
}

/**
 * Get the default project from context (null if in global mode).
 */
export function getDefaultProject(): ProjectManager | null {
  return getCLIContext().project;
}

/**
 * Get the project path from context (null if in global mode).
 */
export function getProjectPath(): string | null {
  return getCLIContext().project?.path ?? null;
}

/**
 * Resolve a project by identifier (ID, name, or path).
 *
 * @param store - ProjectStore instance
 * @param identifier - Project ID, repository name, or filesystem path
 * @returns ProjectManager or undefined if not found
 */
function resolveProjectByIdentifier(
  store: ProjectStore,
  identifier: string
): ProjectManager | undefined {
  // Try by ID first
  let project = store.get(identifier);
  if (project) return project;

  // Try by repository name
  project = store.getByName(identifier);
  if (project) return project;

  // Try by path
  try {
    // Check it's a valid path. It will throw an error
    // @see https://nodejs.org/api/path.html#pathparsepath
    path.parse(identifier);

    let fullPath = identifier;

    if (!path.isAbsolute(identifier)) {
      fullPath = path.resolve(process.cwd(), identifier);
    }

    project = store.getByPath(fullPath);
    if (project) return project;
  } catch (error) {
    if (error instanceof TypeError) {
      // Not a valid path. Skip
    } else {
      throw error;
    }
  }

  return undefined;
}

/**
 * Resolve the effective project for a command.
 *
 * Resolution order:
 * 1. `--project` flag (stored in context)
 * 2. `ROVER_PROJECT` environment variable
 * 3. cwd-based project (from preAction hook)
 *
 * @param projectOverride - Optional project identifier to override context
 * @returns ProjectManager or null (global mode)
 * @throws If --project or ROVER_PROJECT specified but not found
 */
export async function resolveProjectContext(
  projectOverride?: string
): Promise<ProjectManager | null> {
  const ctx = getCLIContext();

  // Always return the pre-resolved project if available
  if (ctx.project) {
    return ctx.project;
  }

  // Use the id from the override or context
  const projectId = projectOverride ?? ctx.projectOption;

  // If a project identifier is provided, resolve it
  if (projectId) {
    const store = new ProjectStore();
    const project = resolveProjectByIdentifier(store, projectId);

    if (project) {
      return project;
    }
  }

  // No project available, return null (global mode)
  return null;
}

/**
 * Require a project context for a command.
 *
 * Use this for commands that cannot operate in global mode and require
 * either a project in the current working directory (cwd) or the
 * `--project` flag.
 *
 * @param projectOverride - Optional project identifier to override context
 * @returns ProjectManager
 * @throws If no project context available
 */
export async function requireProjectContext(
  projectOverride?: string
): Promise<ProjectManager> {
  const project = await resolveProjectContext(projectOverride);
  if (project) {
    return project;
  }

  throw new Error(
    'Not in a project. Run from a git repository or use --project option.'
  );
}
