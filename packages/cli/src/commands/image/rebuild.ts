/**
 * rover image rebuild - Force rebuild the custom Docker image
 *
 * This command rebuilds the custom image with --no-cache to ensure
 * all layers are refreshed.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import colors from 'ansi-colors';
import { getVersion, launch, ProjectConfigManager } from 'rover-core';
import { DockerfileBuilder } from '../../lib/dockerfile-builder.js';
import { computePackagesHash } from '../../lib/image-status.js';
import { getProjectPath } from '../../lib/context.js';
import { exitWithError, exitWithSuccess } from '../../utils/exit.js';
import type { CommandDefinition } from '../../types.js';

const DOCKERFILE_NAME = 'Dockerfile.rover';

interface RebuildOptions {
  tag?: string;
  json?: boolean;
}

interface RebuildResult {
  success: boolean;
  imageTag?: string;
  error?: string;
}

async function rebuildAction(options: RebuildOptions): Promise<void> {
  const projectPath = getProjectPath();

  if (!projectPath) {
    return exitWithError({
      success: false,
      error: 'No project context found. Run `rover init` first.',
    });
  }

  // Load project config
  let projectConfig: ProjectConfigManager;
  try {
    projectConfig = ProjectConfigManager.load(projectPath);
  } catch (error) {
    return exitWithError({
      success: false,
      error: `Failed to load project configuration: ${error}`,
    });
  }

  const dockerfilePath = join(projectPath, DOCKERFILE_NAME);

  // Regenerate Dockerfile to ensure it's up to date
  const builder = new DockerfileBuilder(projectConfig);
  const dockerfileContent = builder.generate();
  const imageTag = options.tag || builder.getImageTag();
  const baseImage = builder.getBaseImage();

  try {
    writeFileSync(dockerfilePath, dockerfileContent, 'utf-8');
  } catch (error) {
    return exitWithError({
      success: false,
      error: `Failed to write ${DOCKERFILE_NAME}: ${error}`,
    });
  }

  if (!options.json) {
    console.log(colors.green(`✓ Regenerated ${DOCKERFILE_NAME}`));
    console.log(colors.cyan(`\nRebuilding image: ${imageTag} (no-cache)`));
  }

  try {
    const result = await launch(
      'docker',
      ['build', '--no-cache', '-f', DOCKERFILE_NAME, '-t', imageTag, '.'],
      {
        cwd: projectPath,
        stdio: options.json ? 'pipe' : 'inherit',
      }
    );

    if (result.exitCode !== 0) {
      return exitWithError({
        success: false,
        error: `Docker build failed with exit code ${result.exitCode}`,
      });
    }
  } catch (error) {
    return exitWithError({
      success: false,
      error: `Docker build failed: ${error}`,
    });
  }

  // Update rover.json with image metadata
  try {
    projectConfig.setAgentImage(imageTag);
    projectConfig.setGeneratedFrom({
      baseImage,
      roverVersion: getVersion(),
      packagesHash: computePackagesHash(projectConfig),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return exitWithError({
      success: false,
      error: `Failed to update rover.json: ${error}`,
    });
  }

  const result: RebuildResult = {
    success: true,
    imageTag,
  };

  return exitWithSuccess(
    options.json ? null : `Rebuilt image: ${imageTag}`,
    result
  );
}

const rebuildCmd: CommandDefinition = {
  name: 'rebuild',
  parent: 'image',
  description: 'Force rebuild custom image with --no-cache',
  requireProject: true,
  action: rebuildAction,
};

export default rebuildCmd;
