import colors from 'ansi-colors';
import { existsSync } from 'node:fs';
import { ProjectStore, showProperties, showTitle } from 'rover-core';
import { isJsonMode } from '../lib/context.js';
import { getAvailableSandboxBackend } from '../lib/sandbox/index.js';
import { ContainerBackend } from '../lib/sandbox/container-common.js';
import {
  listCacheImages,
  removeCacheImage,
  type CacheImageInfo,
} from '../lib/sandbox/image-cache.js';
import { getTelemetry } from '../lib/telemetry.js';
import type {
  CleanupCommandOutput,
  CleanupOutputImage,
} from '../output-types.js';
import { exitWithError, exitWithSuccess } from '../utils/exit.js';
import type { CommandDefinition } from '../types.js';

/**
 * Determine which cache images to keep and which to remove.
 *
 * Strategy:
 * - Group labeled images by project path
 * - Keep only the most recent image per project
 * - Remove images whose project path no longer exists on disk
 *   or isn't registered in the project store
 * - Remove all unlabeled images (legacy caches)
 */
function classifyImages(
  images: CacheImageInfo[],
  registeredPaths: Set<string>
): CleanupOutputImage[] {
  // Group by project path (null = unlabeled)
  const byProject = new Map<string | null, CacheImageInfo[]>();

  for (const img of images) {
    const key = img.projectPath;
    if (!byProject.has(key)) {
      byProject.set(key, []);
    }
    byProject.get(key)!.push(img);
  }

  const result: CleanupOutputImage[] = [];

  for (const [projectPath, group] of byProject) {
    // Sort newest first by createdAt string (ISO-like or docker's format)
    group.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    for (let i = 0; i < group.length; i++) {
      const img = group[i];
      let kept: boolean;

      if (projectPath === null) {
        // Unlabeled (legacy) — always remove
        kept = false;
      } else if (
        !existsSync(projectPath) ||
        !registeredPaths.has(projectPath)
      ) {
        // Project no longer exists on disk or isn't registered
        kept = false;
      } else {
        // Keep the most recent, remove the rest
        kept = i === 0;
      }

      result.push({
        tag: img.tag,
        imageId: img.id,
        projectPath: img.projectPath,
        createdAt: img.createdAt,
        kept,
      });
    }
  }

  return result;
}

/**
 * Collect every unique DOCKER_HOST value stored in task sandboxMetadata
 * across all registered projects.  The returned set uses `undefined` to
 * represent the default (no override) host.
 */
function collectDockerHosts(store: ProjectStore): Set<string | undefined> {
  const hosts = new Set<string | undefined>();
  // Always include the default host (current DOCKER_HOST or daemon default)
  hosts.add(undefined);

  for (const project of store.list()) {
    try {
      const manager = store.get(project.id);
      if (!manager) continue;
      for (const task of manager.listTasks()) {
        const dockerHost = task.sandboxMetadata?.dockerHost;
        if (typeof dockerHost === 'string') {
          hosts.add(dockerHost);
        }
      }
    } catch {
      // Skip projects we cannot read
    }
  }

  return hosts;
}

const cleanupCommand = async (
  options: { json?: boolean; dryRun?: boolean } = {}
) => {
  const jsonOutput: CleanupCommandOutput = {
    success: true,
    removedCount: 0,
    keptCount: 0,
    images: [],
  };

  const telemetry = getTelemetry();
  telemetry?.eventCleanup();

  try {
    // 1. Detect container backend
    const backendName = await getAvailableSandboxBackend();

    if (!backendName) {
      jsonOutput.success = false;
      jsonOutput.error =
        'No container backend available. Install Docker or Podman.';
      await exitWithError(jsonOutput, { telemetry });
      return;
    }

    const backend =
      backendName === 'docker'
        ? ContainerBackend.Docker
        : ContainerBackend.Podman;

    // 2. Get registered projects and collect unique DOCKER_HOSTs
    const store = new ProjectStore();
    const registeredPaths = new Set(store.list().map(p => p.path));
    const dockerHosts = collectDockerHosts(store);

    // 3. List cache images on every known DOCKER_HOST
    const allImages: CacheImageInfo[] = [];
    // Track which sandboxMetadata to use when removing each image
    const imageMetadataMap = new Map<
      string,
      Record<string, unknown> | undefined
    >();

    for (const dockerHost of dockerHosts) {
      const metadata = dockerHost ? { dockerHost } : undefined;
      const images = await listCacheImages(backend, metadata);
      for (const img of images) {
        // Avoid duplicates when the same daemon is reachable via
        // multiple host values (e.g. undefined and the explicit default).
        if (!imageMetadataMap.has(img.id)) {
          allImages.push(img);
          imageMetadataMap.set(img.id, metadata);
        }
      }
    }

    if (allImages.length === 0) {
      if (!isJsonMode()) {
        console.log(colors.green('\nNo cache images found. Nothing to clean.'));
      }
      await exitWithSuccess(null, jsonOutput, { telemetry });
      return;
    }

    // 4. Classify images
    const classified = classifyImages(allImages, registeredPaths);
    jsonOutput.images = classified;
    jsonOutput.keptCount = classified.filter(i => i.kept).length;

    const toRemove = classified.filter(i => !i.kept);

    if (toRemove.length === 0) {
      if (!isJsonMode()) {
        console.log(
          colors.green('\nAll cache images are current. Nothing to clean.')
        );
      }
      await exitWithSuccess(null, jsonOutput, { telemetry });
      return;
    }

    // 5. Dry-run or actual removal
    if (options.dryRun) {
      if (!isJsonMode()) {
        showTitle('Cleanup Preview (dry run)');

        showProperties({
          'Images to remove': toRemove.length.toString(),
          'Images to keep': jsonOutput.keptCount.toString(),
        });

        console.log('');
        for (const img of toRemove) {
          const reason = img.projectPath === null ? 'unlabeled' : 'stale';
          console.log(
            `  ${colors.red('remove')} ${colors.cyan(img.tag)} ${colors.gray(`(${reason})`)}`
          );
        }

        const kept = classified.filter(i => i.kept);
        if (kept.length > 0) {
          console.log('');
          for (const img of kept) {
            console.log(
              `  ${colors.green('keep  ')} ${colors.cyan(img.tag)} ${colors.gray(`(${img.projectPath})`)}`
            );
          }
        }
      }

      jsonOutput.removedCount = 0;
      await exitWithSuccess(null, jsonOutput, { telemetry });
      return;
    }

    // Actual removal — use the right sandboxMetadata per image
    let removedCount = 0;
    for (const img of toRemove) {
      const metadata = imageMetadataMap.get(img.imageId);
      const removed = await removeCacheImage(backend, img.imageId, metadata);
      if (removed) {
        removedCount++;
      }
    }

    jsonOutput.removedCount = removedCount;

    if (!isJsonMode()) {
      showTitle('Cleanup Results');

      showProperties({
        'Images removed': removedCount.toString(),
        'Images kept': jsonOutput.keptCount.toString(),
      });
    }

    await exitWithSuccess(null, jsonOutput, { telemetry });
  } catch (error) {
    jsonOutput.success = false;
    jsonOutput.error = error instanceof Error ? error.message : String(error);
    await exitWithError(jsonOutput, { telemetry });
  }
};

export { cleanupCommand };

export default {
  name: 'cleanup',
  description: 'Remove stale container cache images',
  requireProject: false,
  action: cleanupCommand,
} satisfies CommandDefinition;
