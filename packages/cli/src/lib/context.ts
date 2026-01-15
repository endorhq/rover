/**
 * CLI Context for execution.
 * This module provides a cohesive context object for CLI state management.
 */

import { findProjectRoot, ProjectStore, type ProjectManager } from 'rover-core';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
 * Resolve the effective project for a command.
 *
 * @param projectOption - Value from --project flag (future)
 * @returns ProjectManager or null (global mode)
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
  return getDefaultProject();
}

/**
 * Check if we're in a Rover project directory (has .rover folder).
 *
 * @deprecated Legacy check for backward compatibility with tests that don't
 * initialize a full project context. Will be removed once all code paths
 * properly use ProjectManager.
 */
function legacy_isInRoverProject(): boolean {
  try {
    const roverPath = join(findProjectRoot(), '.rover');
    return existsSync(roverPath);
  } catch {
    // findProjectRoot throws if .rover directory is not found
    return false;
  }
}

/**
 * Require a project context for a command.
 * Use this for commands that cannot operate in global mode.
 *
 * When project is null but we're in a directory with .rover,
 * returns null (typed as ProjectManager) to allow commands to proceed.
 * Commands should use findProjectRoot() to locate project files.
 *
 * @param projectOption - Value from --project flag (future)
 * @returns ProjectManager (may be null if in .rover directory)
 * @throws If no project context available and not in .rover directory
 */
export async function requireProjectContext(
  projectOption?: string
): Promise<ProjectManager> {
  const project = await resolveProjectContext(projectOption);
  if (project) {
    return project;
  }

  // @DEPRECATED: Legacy fallback for backward compatibility.
  // Remove this once all code paths properly use ProjectManager.
  if (legacy_isInRoverProject()) {
    return null as unknown as ProjectManager;
  }

  throw new Error(
    'Not in a project. Run from a git repository or use --project option.'
  );
}
