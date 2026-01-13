export * from './types.js';
export { DockerSandbox } from './docker.js';
export { PodmanSandbox } from './podman.js';

import { DockerSandbox } from './docker.js';
import { PodmanSandbox } from './podman.js';
import { Sandbox } from './types.js';
import { TaskDescriptionManager, ProcessManager } from 'rover-core';

/**
 * Get the available sandbox backend (docker or podman)
 * Prioritizes Docker, then falls back to Podman
 * @returns The name of the available backend or null if none available
 */
export async function getAvailableSandboxBackend(): Promise<
  'docker' | 'podman' | null
> {
  // Try Docker first
  const dockerSandbox = new DockerSandbox({} as TaskDescriptionManager);
  if (await dockerSandbox.isBackendAvailable()) {
    return 'docker';
  }

  // Try Podman as fallback
  const podmanSandbox = new PodmanSandbox({} as TaskDescriptionManager);
  if (await podmanSandbox.isBackendAvailable()) {
    return 'podman';
  }

  return null;
}

export interface CreateSandboxOptions {
  /** Extra arguments to pass to Docker/Podman from CLI */
  extraArgs?: string;
}

/**
 * Create a sandbox instance using the first available backend
 * Prioritizes Docker, then falls back to Podman
 * @param task The task description
 * @param processManager Optional process manager for progress tracking
 * @param options Optional sandbox creation options
 * @returns A Sandbox instance (DockerSandbox or PodmanSandbox)
 * @throws Error if neither Docker nor Podman are available
 */
export async function createSandbox(
  task: TaskDescriptionManager,
  processManager?: ProcessManager,
  options?: CreateSandboxOptions
): Promise<Sandbox> {
  // Try Docker first (priority)
  const dockerSandbox = new DockerSandbox(task, processManager, options);
  if (await dockerSandbox.isBackendAvailable()) {
    return dockerSandbox;
  }

  // Try Podman as fallback
  const podmanSandbox = new PodmanSandbox(task, processManager, options);
  if (await podmanSandbox.isBackendAvailable()) {
    return podmanSandbox;
  }

  // Neither backend is available
  throw new Error(
    'Neither Docker nor Podman are available. Please install Docker or Podman to run tasks.'
  );
}
