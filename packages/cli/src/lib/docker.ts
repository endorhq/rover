import { launch, launchSync } from 'rover-common';
import Stream from 'node:stream';

export class DockerError extends Error {
  constructor(reason: string) {
    super(`Error running docker command. Reason: ${reason}`);
    this.name = 'DockerError';
  }
}

/**
 * A class to manage and run docker commands
 */
export class Docker {
  constructor() {
    // Check docker is available
    if (launchSync('docker', ['--version']).exitCode !== 0) {
      throw new DockerError(
        'Docker is not installed or the daemon is stopped.'
      );
    }
  }

  /**
   * Starts a container based on the given arguments
   *
   * @param name Container name
   * @param image Container image
   * @param mounts Array of mount commands
   * @param workspace User workspace
   * @param cmd The command to pass to docker and its arguments
   * @param extraArgs Other arguments like user
   */
  startContainer(
    name: string,
    image: string,
    mounts: string[],
    workspace: string,
    cmd: string[],
    extraArgs: string[] = []
  ): boolean {
    // First, remove any existing container with the same name
    this.removeContainer(name);

    // Build docker run command
    const args = [
      'run',
      '--name',
      name,
      '-d', // Run in detached mode
      '-w',
      workspace,
      ...mounts,
      ...extraArgs,
      image,
      ...cmd,
    ];

    const result = launchSync('docker', args);

    return result?.exitCode === 0;
  }

  /**
   * Stop the given container
   *
   * @param name Container name
   */
  stopContainer(name: string): boolean {
    const result = launchSync('docker', ['stop', name]);

    return result?.exitCode === 0;
  }

  /**
   * Returns the container logs (just one shot)
   *
   * @param name Container name
   */
  logsContainer(name: string): string {
    const result = launchSync('docker', ['logs', name]);

    if (result.exitCode !== 0) {
      return '';
    }

    // Combine stdout and stderr
    const stdout = result.stdout?.toString() || '';
    const stderr = result.stderr?.toString() || '';

    return stdout + stderr;
  }

  /**
   * Returns a process to follow the container logs
   *
   * @param name Container name
   */
  logsFollowContainer(name: string) {
    // Start docker logs with follow flag
    const logsProcess = launch('docker', ['logs', '-f', name]);

    return logsProcess;
  }

  /**
   * Clean up any existing container with the given name
   *
   * @param name Container name
   * @returns True when the docker command does not return any error
   */
  removeContainer(name: string): boolean {
    const result = launchSync('docker', ['rm', '-f', name]);

    return result?.exitCode == null;
  }
}

export default Docker;
