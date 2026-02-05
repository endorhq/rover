/**
 * rover image build - Generate and build a custom Docker image for the project
 *
 * This command generates a Dockerfile.rover that pre-installs all detected
 * languages, package managers, and task managers, then optionally builds it.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import colors from 'ansi-colors';
import { getVersion, launch, ProjectConfigManager } from 'rover-core';
import { DockerfileBuilder } from '../../lib/dockerfile-builder.js';
import { computePackagesHash } from '../../lib/image-status.js';
import { getDefaultAgentImage } from '../../lib/sandbox/container-common.js';
import { getProjectPath } from '../../lib/context.js';
import { exitWithError, exitWithSuccess } from '../../utils/exit.js';
import type { CommandDefinition } from '../../types.js';

const DOCKERFILE_NAME = 'Dockerfile.rover';

interface BuildOptions {
  build?: boolean;
  force?: boolean;
  tag?: string;
  withAgent?: string;
  json?: boolean;
}

interface BuildResult {
  success: boolean;
  dockerfilePath?: string;
  imageTag?: string;
  error?: string;
}

async function buildAction(options: BuildOptions): Promise<void> {
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
  const shouldBuild = options.build !== false;

  // Check if Dockerfile.rover already exists
  if (existsSync(dockerfilePath) && !options.force) {
    return exitWithError({
      success: false,
      error: `${DOCKERFILE_NAME} already exists. Use --force to overwrite.`,
    });
  }

  // Generate Dockerfile
  const builder = new DockerfileBuilder(projectConfig, {
    withAgent: options.withAgent,
  });
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
    console.log(colors.green(`✓ Generated ${DOCKERFILE_NAME}`));
  }

  // Build the image if requested
  if (shouldBuild) {
    if (!options.json) {
      console.log(colors.cyan(`\nBuilding image: ${imageTag}`));
    }

    try {
      const result = await launch(
        'docker',
        ['build', '-f', DOCKERFILE_NAME, '-t', imageTag, '.'],
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
      // Skip package installation in entrypoint since they're pre-installed in the image
      projectConfig.setSkipPackageInstall(true);
    } catch (error) {
      return exitWithError({
        success: false,
        error: `Failed to update rover.json: ${error}`,
      });
    }

    const result: BuildResult = {
      success: true,
      dockerfilePath,
      imageTag,
    };

    return exitWithSuccess(
      options.json ? null : `Built image: ${imageTag}`,
      result
    );
  }

  const result: BuildResult = {
    success: true,
    dockerfilePath,
  };

  return exitWithSuccess(
    options.json ? null : `Generated ${DOCKERFILE_NAME} (build skipped)`,
    result
  );
}

const buildCmd: CommandDefinition = {
  name: 'build',
  parent: 'image',
  description: 'Generate Dockerfile.rover and build custom image',
  requireProject: true,
  action: buildAction,
};

export default buildCmd;
