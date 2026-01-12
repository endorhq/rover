export * from './types.js';
export * from './config.js';
export { DockerSandbox } from './docker.js';
export { PodmanSandbox } from './podman.js';

import { DockerSandbox } from './docker.js';
import { PodmanSandbox } from './podman.js';
import { Sandbox } from './types.js';
import { TaskDescriptionManager, ProcessManager } from 'rover-core';
import {
  loadSandboxConfig,
  isGVisorAvailable,
  type SecurityLevel,
} from './config.js';

/**
 * Available sandbox backend types
 */
export type SandboxBackend = 'docker' | 'docker-gvisor' | 'podman' | null;

/**
 * Information about the available sandbox backend
 */
export interface SandboxBackendInfo {
  backend: SandboxBackend;
  securityLevel: SecurityLevel;
  gvisorAvailable: boolean;
}

/**
 * Get the available sandbox backend (docker or podman)
 * Prioritizes Docker, then falls back to Podman
 * @returns The name of the available backend or null if none available
 */
export async function getAvailableSandboxBackend(): Promise<SandboxBackend> {
  // Try Docker first
  const dockerSandbox = new DockerSandbox({} as TaskDescriptionManager);
  if (await dockerSandbox.isBackendAvailable()) {
    // Check if gVisor is available for enhanced security
    const config = loadSandboxConfig();
    if (
      config.securityLevel === 'enhanced' ||
      config.forceBackend === 'gvisor'
    ) {
      const gvisorAvailable = await isGVisorAvailable();
      if (gvisorAvailable) {
        return 'docker-gvisor';
      }
    }
    return 'docker';
  }

  // Try Podman as fallback
  const podmanSandbox = new PodmanSandbox({} as TaskDescriptionManager);
  if (await podmanSandbox.isBackendAvailable()) {
    return 'podman';
  }

  return null;
}

/**
 * Get detailed information about available sandbox backends
 */
export async function getSandboxBackendInfo(): Promise<SandboxBackendInfo> {
  const config = loadSandboxConfig();
  const gvisorAvailable = await isGVisorAvailable();

  // Try Docker first
  const dockerSandbox = new DockerSandbox({} as TaskDescriptionManager);
  if (await dockerSandbox.isBackendAvailable()) {
    const useGVisor =
      gvisorAvailable &&
      (config.securityLevel === 'enhanced' || config.forceBackend === 'gvisor');

    return {
      backend: useGVisor ? 'docker-gvisor' : 'docker',
      securityLevel: useGVisor ? 'enhanced' : 'standard',
      gvisorAvailable,
    };
  }

  // Try Podman as fallback
  const podmanSandbox = new PodmanSandbox({} as TaskDescriptionManager);
  if (await podmanSandbox.isBackendAvailable()) {
    return {
      backend: 'podman',
      securityLevel: 'standard', // Podman doesn't support gVisor
      gvisorAvailable: false,
    };
  }

  return {
    backend: null,
    securityLevel: 'standard',
    gvisorAvailable: false,
  };
}

/**
 * Create a sandbox instance using the first available backend
 * Prioritizes Docker, then falls back to Podman
 * @param task The task description
 * @param processManager Optional process manager for progress tracking
 * @returns A Sandbox instance (DockerSandbox or PodmanSandbox)
 * @throws Error if neither Docker nor Podman are available
 */
export async function createSandbox(
  task: TaskDescriptionManager,
  processManager?: ProcessManager
): Promise<Sandbox> {
  // Try Docker first (priority)
  const dockerSandbox = new DockerSandbox(task, processManager);
  if (await dockerSandbox.isBackendAvailable()) {
    return dockerSandbox;
  }

  // Try Podman as fallback
  const podmanSandbox = new PodmanSandbox(task, processManager);
  if (await podmanSandbox.isBackendAvailable()) {
    return podmanSandbox;
  }

  // Neither backend is available
  throw new Error(
    'Neither Docker nor Podman are available. Please install Docker or Podman to run tasks.'
  );
}
