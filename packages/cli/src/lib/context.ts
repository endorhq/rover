/**
 * CLI Context for execution.
 * This module provides a cohesive context object for CLI state management.
 */

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
 * Resolve the effective project for a command.
 *
 * @param projectOption - Value from --project flag (future)
 * @returns ProjectManager and projectPath or null (global mode)
 * @throws If --project specified but not found
 */
export async function resolveProjectContext(
  projectOption?: string
): Promise<ProjectManager | null> {
  // If --project is provided, resolve that specific project
  if (projectOption) {
    const store = new ProjectStore();
    // Try by ID first, then by path
    const project = store.get(projectOption) ?? store.getByPath(projectOption);
    if (!project) {
      throw new Error(`Project "${projectOption}" not found`);
    }
    return project;
  }

  // Otherwise, use the default context from pre-action hook
  const project = getDefaultProject();

  if (project) {
    return project;
  }

  return null;
}

/**
 * Require a project context for a command. It returns the project and projectPath
 * as an object. If it cannot initialize the project, it will throw an error.
 *
 * Use this for commands that cannot operate in global mode and require
 * either a project in the current working directory (cwd) or the
 * `--project` flag.
 *
 * @param projectOption - Value from --project flag (future)
 * @returns ProjectManager and projectPath
 * @throws If no project context available
 */
export async function requireProjectContext(
  projectOption?: string
): Promise<ProjectManager> {
  const resolved = await resolveProjectContext(projectOption);
  if (resolved) {
    return resolved;
  }

  throw new Error(
    'Not in a project. Run from a git repository or use --project option.'
  );
}
