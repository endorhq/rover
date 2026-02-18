/**
 * CLI Context for execution.
 * This module provides a cohesive context object for CLI state management.
 */

import colors from 'ansi-colors';
import path from 'node:path';
import {
  findOrRegisterProject,
  type ProjectManager,
  ProjectStore,
} from 'rover-core';
import { isInteractiveTerminal } from '../utils/stdin.js';

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
 * Options for requireProjectContext
 */
export interface RequireProjectOptions {
  /** If true, disable showing the interactive project selector */
  disableProjectSelection?: boolean;
  /** Missing project message */
  missingProjectMessage?: string;
}

/**
 * Require a project context for a command.
 *
 * Use this for commands that cannot operate in global mode and require
 * either a project in the current working directory (cwd) or the
 * `--project` flag.
 *
 * @param projectOverride - Optional project identifier to override context
 * @param options - Configuration options
 * @returns ProjectManager
 * @throws If no project context available
 */
export async function requireProjectContext(
  projectOverride?: string,
  options: RequireProjectOptions = {}
): Promise<ProjectManager> {
  const project = await resolveProjectContext(projectOverride);
  if (project) {
    return project;
  }

  // Check if we can show the interactive selector
  const showSelector =
    !options.disableProjectSelection &&
    isInteractiveTerminal() &&
    !isJsonMode();

  if (showSelector) {
    if (options.missingProjectMessage) {
      console.log(`\n${options.missingProjectMessage}`);
    }

    // Break line.
    console.log();

    // Dynamic import to avoid loading enquirer during test setup
    const { promptProjectSelection } = await import(
      '../utils/project-selector.js'
    );
    const selectedProject = await promptProjectSelection();
    if (selectedProject) {
      // Update context with the selected project
      setProject(selectedProject);
      return selectedProject;
    }
    // User cancelled the selection
    throw new Error('Project selection cancelled.');
  }

  if (projectOverride) {
    throw new Error(
      `Could not find project '${projectOverride}'. Please check the identifier and try again.`
    );
  } else {
    throw new Error(
      'This Rover command requires a project to run. You can:\n\n- Run it on a git repository folder (Rover will autoregister the project)\n- Use the --project option.\n- Set the ROVER_PROJECT environment variable.'
    );
  }
}
