import { basename, join } from 'node:path';
import { Git } from '../git.js';
import type { ProjectManager } from './project.js';
import { ProjectStore, ProjectStoreLoadError } from './project-store.js';
import { readFileSync } from 'node:fs';

/**
 * Error thrown when not inside a git repository
 */
export class ProjectLoaderNotGitRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectLoaderNotGitRepoError';
  }
}

/**
 * Error thrown when project registration fails
 */
export class ProjectLoaderRegistrationError extends Error {
  constructor(
    message: string,
    public readonly reason?: unknown
  ) {
    super(message);
    this.name = 'ProjectLoaderRegistrationError';
  }
}

/**
 * Error thrown when project store cannot be loaded
 */
export class ProjectLoaderStoreError extends Error {
  constructor(
    message: string,
    public readonly reason?: unknown
  ) {
    super(message);
    this.name = 'ProjectLoaderStoreError';
  }
}

export type FindOrRegisterProjectOptions = {
  /** Working directory to check. Defaults to process.cwd() */
  cwd?: string;
};

/**
 * Find a project by path in global config, or auto-register if not found.
 * Requires the current directory to be inside a git repository.
 *
 * @param options - Configuration options
 * @returns ProjectManager instance for the current project
 * @throws {ProjectLoaderNotGitRepoError} When not in a git repo
 * @throws {ProjectLoaderStoreError} When project store cannot be loaded
 * @throws {ProjectLoaderRegistrationError} When project registration fails
 */
export async function findOrRegisterProject(
  options: FindOrRegisterProjectOptions = {}
): Promise<ProjectManager> {
  const cwd = options.cwd;
  const git = new Git({ cwd });

  // Check if inside a git repository
  if (!git.isGitRepo()) {
    throw new ProjectLoaderNotGitRepoError(
      'Not inside a git repository. Run "git init" to initialize one.'
    );
  }

  // Get project root path
  const projectRoot = git.getRepositoryRoot();
  if (!projectRoot) {
    throw new ProjectLoaderNotGitRepoError(
      'Could not determine git repository root.'
    );
  }

  // Load project store
  let store: ProjectStore;
  try {
    store = new ProjectStore();
  } catch (error) {
    if (error instanceof ProjectStoreLoadError) {
      throw new ProjectLoaderStoreError(
        'Failed to load project store.',
        error.reason
      );
    }
    throw new ProjectLoaderStoreError('Failed to load project store.', error);
  }

  // Check if project already exists
  const existingProject = store.getByPath(projectRoot);
  if (existingProject) {
    return existingProject;
  }

  // Auto-register new project
  const projectName = deriveProjectName(git, projectRoot);

  // Try to load the nextTaskID if available!
  // @legacy
  let initialTaskId = 1;

  try {
    const nextTaskId = readFileSync(
      join(projectRoot, '.rover', 'task-counter.json'),
      'utf-8'
    );
    initialTaskId = parseInt(JSON.parse(nextTaskId).nextId, 10) ?? 1;
  } catch {
    // Just keep the default value to 1
  }

  try {
    return await store.add(projectName, projectRoot, {
      autodetect: true,
      initialTaskId: Number.isNaN(initialTaskId) ? 1 : initialTaskId,
    });
  } catch (error) {
    throw new ProjectLoaderRegistrationError(
      `Failed to register project "${projectName}".`,
      error
    );
  }
}

/**
 * Derive a project name from git remote (user/repo) or directory name
 */
function deriveProjectName(git: Git, projectRoot: string): string {
  const remoteUrl = git.remoteUrl();

  if (remoteUrl) {
    // Extract user/repo from remote URL
    // Handles: git@github.com:user/repo.git, https://github.com/user/repo.git
    const sshMatch = remoteUrl.match(/:([^/]+\/[^/]+?)(?:\.git)?$/);
    if (sshMatch) {
      return sshMatch[1];
    }

    const httpsMatch = remoteUrl.match(/\/([^/]+\/[^/]+?)(?:\.git)?$/);
    if (httpsMatch) {
      return httpsMatch[1];
    }
  }

  // Fallback to directory name
  return basename(projectRoot);
}
