/**
 * CLI Context for execution.
 * This module provides a cohesive context object for CLI state management.
 */

import { resolve } from 'node:path';
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
 * Resolution order:
 * 1. If context.project is already set (from preAction), return it
 * 2. If projectOption is provided, look it up
 * 3. If ROVER_PROJECT env is set, look it up
 * 4. Fall back to default project from context
 *
 * @param projectOption - Value from --project flag
 * @returns ProjectManager or null (global mode)
 * @throws If project override specified but not found
 */
export async function resolveProjectContext(
  projectOption?: string
): Promise<ProjectManager | null> {
  // If context already has a project (set by preAction), return it
  // This avoids double resolution
  const contextProject = getDefaultProject();
  if (contextProject) {
    return contextProject;
  }

  // Determine the override value (flag takes precedence over env)
  const override = projectOption || process.env.ROVER_PROJECT;

  // If an override is provided, resolve that specific project
  if (override) {
    const store = new ProjectStore();
    // Try by ID first, then by normalized path
    const project = store.get(override) ?? store.getByPath(resolve(override));
    if (!project) {
      throw new Error(`Project "${override}" not found`);
    }
    return project;
  }

  // No override and no context project - return null (global mode)
  return null;
}

/**
 * Require a project context for a command.
 * Use this for commands that cannot operate in global mode.
 *
 * @param projectOption - Value from --project flag
 * @returns ProjectManager
 * @throws If no project context available
 */
export async function requireProjectContext(
  projectOption?: string
): Promise<ProjectManager> {
  const project = await resolveProjectContext(projectOption);
  if (project) {
    return project;
  }

  throw new Error(
    'Not in a project. Run from a git repository, use --project <name|path>, or set ROVER_PROJECT env var.'
  );
}
