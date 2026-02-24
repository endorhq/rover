import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  launch,
  launchSync,
  getVersion,
  ProjectConfigManager,
} from 'rover-core';
import { ContainerBackend } from './container-common.js';

/**
 * Build a process env with DOCKER_HOST set when the sandbox metadata
 * carries a custom `dockerHost`.  Returns `undefined` when no override
 * is needed so callers can skip the option entirely.
 */
function envFromSandboxMetadata(
  sandboxMetadata?: Record<string, unknown>
): NodeJS.ProcessEnv | undefined {
  const dockerHost = sandboxMetadata?.dockerHost;
  if (typeof dockerHost === 'string') {
    return { ...process.env, DOCKER_HOST: dockerHost };
  }
  return undefined;
}

/**
 * Expected exit code for init-only containers.
 * When the entrypoint finishes setup and hits `"$@"` which is `true`,
 * the container exits with 0, indicating initialization completed
 * successfully and the container is ready to be committed as a cached image.
 */
const INIT_EXPECTED_EXIT_CODE = 0;

export interface SetupHashInputs {
  agentImage: string;
  languages: string[];
  packageManagers: string[];
  taskManagers: string[];
  agent: string;
  roverVersion: string;
  initScriptContent: string;
  cacheFilesContent: string;
  mcps: Array<{
    name: string;
    commandOrUrl: string;
    transport: string;
    envs?: string[];
    headers?: string[];
  }>;
}

/**
 * Compute a SHA-256 hash of the setup inputs that determine the container
 * image state. Arrays are sorted for determinism so that different ordering
 * of the same values produces the same hash.
 */
export function computeSetupHash(inputs: SetupHashInputs): string {
  const normalized = {
    agentImage: inputs.agentImage,
    languages: [...inputs.languages].sort(),
    packageManagers: [...inputs.packageManagers].sort(),
    taskManagers: [...inputs.taskManagers].sort(),
    agent: inputs.agent,
    roverVersion: inputs.roverVersion,
    initScriptContent: inputs.initScriptContent,
    cacheFilesContent: inputs.cacheFilesContent,
    mcps: [...inputs.mcps]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(mcp => ({
        name: mcp.name,
        commandOrUrl: mcp.commandOrUrl,
        transport: mcp.transport,
        envs: [...(mcp.envs || [])].sort(),
        headers: [...(mcp.headers || [])].sort(),
      })),
  };

  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * Build the local cache image tag from a setup hash.
 * Uses the first 16 hex characters of the hash.
 */
export function getCacheImageTag(hash: string): string {
  return `rover-cache:${hash.slice(0, 16)}`;
}

/**
 * Check whether a cached image already exists locally.
 */
export function cacheImageExists(
  backend: ContainerBackend,
  tag: string
): boolean {
  try {
    const result = launchSync(backend, ['image', 'inspect', tag], {
      reject: false,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Wait for an init-only container to exit, verify it exited successfully
 * (exit code 0), commit the container as a cached image, and clean up.
 *
 * Returns `true` if the image was committed successfully, `false` otherwise.
 */
export async function waitForInitAndCommit(
  backend: ContainerBackend,
  containerName: string,
  cacheTag: string,
  projectPath?: string,
  agent?: string,
  sandboxMetadata?: Record<string, unknown>
): Promise<boolean> {
  const env = envFromSandboxMetadata(sandboxMetadata);
  const opts = env ? { env } : undefined;
  try {
    // `docker/podman wait` prints the exit code to stdout
    const waitResult = await launch(backend, ['wait', containerName], opts);
    const exitCode = parseInt(waitResult.stdout?.toString().trim() || '', 10);

    if (exitCode === INIT_EXPECTED_EXIT_CODE) {
      const commitArgs = ['commit'];
      if (projectPath) {
        commitArgs.push('--change', `LABEL rover.project.path=${projectPath}`);
      }
      if (agent) {
        commitArgs.push('--change', `LABEL rover.agent=${agent}`);
      }
      commitArgs.push(containerName, cacheTag);
      await launch(backend, commitArgs, opts);
      await launch(backend, ['rm', '-f', containerName], opts);
      return true;
    }

    // Container exited with an unexpected code — don't commit
    await launch(backend, ['rm', '-f', containerName], opts);
    return false;
  } catch {
    // Best-effort cleanup
    try {
      await launch(backend, ['rm', '-f', containerName], opts);
    } catch {
      // ignore cleanup errors
    }
    return false;
  }
}

/**
 * Convenience function: compute hash, build tag, check existence.
 * Returns the cache tag and whether a cached image already exists.
 */
export function checkImageCache(
  backend: ContainerBackend,
  projectConfig: ProjectConfigManager,
  agentImage: string,
  agent: string
): { hasCachedImage: boolean; cacheTag: string } {
  let initScriptContent = '';
  if (projectConfig.initScript) {
    try {
      const initScriptAbsPath = join(
        projectConfig.projectRoot,
        projectConfig.initScript
      );
      initScriptContent = readFileSync(initScriptAbsPath, 'utf-8');
    } catch {
      // If the file can't be read, treat content as empty — the hash
      // will change once the file appears.
    }
  }

  let cacheFilesContent = '';
  if (projectConfig.cacheFiles) {
    const parts: string[] = [];
    for (const filePath of [...projectConfig.cacheFiles].sort()) {
      try {
        const absPath = join(projectConfig.projectRoot, filePath);
        parts.push(`${filePath}\0${readFileSync(absPath, 'utf-8')}`);
      } catch {
        // If a file can't be read, skip it — the hash will change
        // once the file appears.
      }
    }
    cacheFilesContent = parts.join('\0');
  }

  const hash = computeSetupHash({
    agentImage,
    languages: projectConfig.languages,
    packageManagers: projectConfig.packageManagers,
    taskManagers: projectConfig.taskManagers,
    agent,
    roverVersion: getVersion(),
    initScriptContent,
    cacheFilesContent,
    mcps: projectConfig.mcps,
  });

  const cacheTag = getCacheImageTag(hash);
  const hasCachedImage = cacheImageExists(backend, cacheTag);

  return { hasCachedImage, cacheTag };
}

export interface CacheImageInfo {
  id: string;
  tag: string;
  createdAt: string;
  projectPath: string | null;
  agent: string | null;
}

/**
 * List all rover-cache images with their metadata.
 * Uses `docker/podman images` with JSON format to retrieve image info,
 * then inspects each image to read the `rover.project.path` label.
 */
export async function listCacheImages(
  backend: ContainerBackend,
  sandboxMetadata?: Record<string, unknown>
): Promise<CacheImageInfo[]> {
  const env = envFromSandboxMetadata(sandboxMetadata);
  const opts = env ? { env } : undefined;
  try {
    const result = await launch(
      backend,
      ['images', '--filter', 'reference=rover-cache', '--format', 'json'],
      opts
    );

    const stdout = result.stdout?.toString().trim() || '';
    if (!stdout) return [];

    // Docker outputs one JSON object per line (NDJSON), Podman outputs a JSON array
    let entries: Array<{
      ID: string;
      Tag: string;
      CreatedAt?: string;
      CreatedSince?: string;
      Repository?: string;
    }>;

    if (stdout.startsWith('[')) {
      entries = JSON.parse(stdout);
    } else {
      entries = stdout
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    }

    const images: CacheImageInfo[] = [];

    for (const entry of entries) {
      const tag =
        entry.Repository && entry.Tag
          ? `${entry.Repository}:${entry.Tag}`
          : `rover-cache:${entry.Tag || 'latest'}`;

      const labels = await getCacheImageLabels(
        backend,
        entry.ID,
        sandboxMetadata
      );

      images.push({
        id: entry.ID,
        tag,
        createdAt: entry.CreatedAt || entry.CreatedSince || '',
        projectPath: labels['rover.project.path'] || null,
        agent: labels['rover.agent'] || null,
      });
    }

    return images;
  } catch {
    return [];
  }
}

/**
 * Read labels from a container image via `docker/podman image inspect`.
 */
export async function getCacheImageLabels(
  backend: ContainerBackend,
  imageId: string,
  sandboxMetadata?: Record<string, unknown>
): Promise<Record<string, string>> {
  const env = envFromSandboxMetadata(sandboxMetadata);
  const opts = env ? { env } : undefined;
  try {
    const result = await launch(
      backend,
      ['image', 'inspect', '--format', '{{json .Config.Labels}}', imageId],
      opts
    );

    const stdout = result.stdout?.toString().trim() || '';
    if (!stdout || stdout === 'null' || stdout === 'map[]') return {};

    return JSON.parse(stdout) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Remove a cache image by its ID.
 */
export async function removeCacheImage(
  backend: ContainerBackend,
  imageId: string,
  sandboxMetadata?: Record<string, unknown>
): Promise<boolean> {
  const env = envFromSandboxMetadata(sandboxMetadata);
  const opts = env ? { env } : undefined;
  try {
    await launch(backend, ['rmi', '--force', imageId], opts);
    return true;
  } catch {
    return false;
  }
}
