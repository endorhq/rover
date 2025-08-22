import { ChildProcessByStdio, spawn, spawnSync } from 'node:child_process';
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
        if (spawnSync('docker', ['--version'], { stdio: 'pipe' }).error) {
            throw new DockerError('Docker is not installed or the daemon is stopped.');
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
    startContainer(name: string, image: string, mounts: string[], workspace: string, cmd: string[], extraArgs: string[] = []): boolean {
        // First, remove any existing container with the same name
        this.removeContainer(name);

        // Build docker run command
        const args = [
            'run',
            '--name', name,
            '-d', // Run in detached mode
            '-w', workspace,
            ...mounts,
            ...extraArgs,
            image,
            ...cmd
        ];

        const result = spawnSync('docker', args, { stdio: 'pipe' });

        return result.error == null && result.status === 0;
    }

    /**
     * Stop the given container
     *
     * @param name Container name
     */
    stopContainer(name: string): boolean {
        const result = spawnSync('docker', ['stop', name], { stdio: 'pipe' });

        return result.error == null && result.status === 0;
    }

    /**
     * Returns the container logs (just one shot)
     *
     * @param name Container name
     */
    logsContainer(name: string): string {
        const result = spawnSync('docker', ['logs', name], {
            stdio: 'pipe',
            encoding: 'utf8'
        });

        if (result.error != null || result.status !== 0) {
            return '';
        }

        // Combine stdout and stderr
        const stdout = result.stdout || '';
        const stderr = result.stderr || '';

        return stdout + stderr;
    }

    /**
     * Returns a process to follow the container logs
     *
     * @param name Container name
     */
    logsFollowContainer(name: string): ChildProcessByStdio<null, Stream.Readable, Stream.Readable> {
        // Start docker logs with follow flag
        const logsProcess = spawn('docker', ['logs', '-f', name], {
            stdio: ['ignore', 'pipe', 'pipe']
        }) as ChildProcessByStdio<null, Stream.Readable, Stream.Readable>;

        return logsProcess;
    }

    /**
     * Clean up any existing container with the given name
     *
     * @param name Container name
     * @returns True when the docker command does not return any error
     */
    removeContainer(name: string): boolean {
        const result = spawnSync('docker', ['rm', '-f', name], { stdio: 'pipe' });

        return result.error == null;
    }
}

export default Docker;
