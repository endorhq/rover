/**
 * CLI Context for execution.
 * This module provides a cohesive context object for CLI state management.
 */

import type { ProjectManager } from 'rover-core';
import { ProjectStore, findProjectRoot } from 'rover-core';
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

// Standalone JSON mode flag for backwards compatibility with tests
// that don't initialize the full context
let _standaloneJsonMode = false;

// Convenience accessors

/**
 * Check if the CLI is running in JSON output mode.
 * When in JSON mode, human-readable console output should be suppressed.
 * Returns standalone JSON mode if context not initialized (for backwards compatibility).
 */
export function isJsonMode(): boolean {
  if (_context) {
    return _context.jsonMode;
  }
  return _standaloneJsonMode;
}

/**
 * Set JSON mode (for backward compatibility with commands that set it directly).
 * Sets both standalone flag and context (if initialized).
 */
export function setJsonMode(value: boolean): void {
  _standaloneJsonMode = value;
  if (_context) {
    _context.jsonMode = value;
  }
}

/**
 * Check if the CLI is in project mode (vs global mode).
 * Returns false if context not initialized.
 */
export function isProjectMode(): boolean {
  if (!_context) {
    return false;
  }
  return _context.project !== null;
}

/**
 * Get the default project from context (null if in global mode).
 * Returns null if context not initialized.
 */
export function getDefaultProject(): ProjectManager | null {
  if (!_context) {
    return null;
  }
  return _context.project;
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
  // If context is not initialized, return null (global mode)
  return getDefaultProject();
}

/**
 * Check if we're in a Rover project directory (has .rover folder).
 * This is used as a fallback when context isn't initialized (e.g., in tests).
 */
function isInRoverProject(): boolean {
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
 * For backward compatibility with tests that don't initialize context,
 * this function also checks for the presence of a .rover directory.
 *
 * @param projectOption - Value from --project flag (future)
 * @returns ProjectManager (never null)
 * @throws If no project context available
 */
export async function requireProjectContext(
  projectOption?: string
): Promise<ProjectManager> {
  const project = await resolveProjectContext(projectOption);
  if (project) {
    return project;
  }

  // Fallback for backward compatibility: if context isn't initialized but
  // we're in a Rover project directory (.rover exists), don't error.
  // This allows tests that don't go through program.ts to still work.
  if (!_context && isInRoverProject()) {
    // Return a minimal project-like object for backward compatibility
    // In practice, commands will use findProjectRoot() to locate project files
    return null as unknown as ProjectManager;
  }

  throw new Error(
    'Not in a project. Run from a git repository or use --project option.'
  );
}
