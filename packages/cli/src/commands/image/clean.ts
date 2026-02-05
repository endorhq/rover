/**
 * rover image clean - Remove Dockerfile.rover and optionally the Docker image
 *
 * This command removes the generated Dockerfile.rover and can optionally
 * remove the Docker image and reset the configuration in rover.json.
 */

import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import colors from 'ansi-colors';
import enquirer from 'enquirer';
import { launch, ProjectConfigManager } from 'rover-core';
import { getProjectPath, isJsonMode, setJsonMode } from '../../lib/context.js';
import { exitWithError, exitWithSuccess } from '../../utils/exit.js';
import type { CommandDefinition } from '../../types.js';

const { prompt } = enquirer;

const DOCKERFILE_NAME = 'Dockerfile.rover';

interface CleanOptions {
  removeImage?: boolean;
  resetConfig?: boolean;
  yes?: boolean;
  json?: boolean;
}

interface CleanResult {
  success: boolean;
  dockerfileRemoved: boolean;
  imageRemoved: boolean;
  configReset: boolean;
  error?: string;
}

async function cleanAction(options: CleanOptions): Promise<void> {
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

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
  const dockerfileExists = existsSync(dockerfilePath);
  const imageTag = projectConfig.agentImage;
  const skipConfirmation = options.yes === true || isJsonMode();

  // Check if there's anything to clean
  if (
    !dockerfileExists &&
    !imageTag &&
    !projectConfig.generatedFrom &&
    !projectConfig.skipPackageInstall
  ) {
    return exitWithError({
      success: false,
      error: 'No custom image configuration found.',
    });
  }

  // Show what will be removed
  if (!isJsonMode()) {
    console.log(colors.yellow('The following will be removed:'));
    if (dockerfileExists) {
      console.log(`  - ${DOCKERFILE_NAME}`);
    }
    if (options.removeImage && imageTag) {
      console.log(`  - Docker image: ${imageTag}`);
    }
    if (options.resetConfig && (imageTag || projectConfig.generatedFrom)) {
      console.log(
        '  - sandbox.agentImage, sandbox.generatedFrom, and sandbox.skipPackageInstall from rover.json'
      );
    }
    console.log('');
  }

  // Confirm unless --yes is provided
  if (!skipConfirmation) {
    const response = await prompt<{ confirm: boolean }>({
      type: 'confirm',
      name: 'confirm',
      message: 'Are you sure you want to continue?',
      initial: false,
    });

    if (!response.confirm) {
      console.log(colors.yellow('Cancelled'));
      process.exit(0);
    }
  }

  const result: CleanResult = {
    success: true,
    dockerfileRemoved: false,
    imageRemoved: false,
    configReset: false,
  };

  // Remove Dockerfile.rover
  if (dockerfileExists) {
    try {
      unlinkSync(dockerfilePath);
      result.dockerfileRemoved = true;
      if (!isJsonMode()) {
        console.log(colors.green(`✓ Removed ${DOCKERFILE_NAME}`));
      }
    } catch (error) {
      return exitWithError({
        success: false,
        error: `Failed to remove ${DOCKERFILE_NAME}: ${error}`,
      });
    }
  }

  // Remove Docker image if requested
  if (options.removeImage && imageTag) {
    try {
      await launch('docker', ['rmi', imageTag], {
        stdio: isJsonMode() ? 'pipe' : 'inherit',
      });
      result.imageRemoved = true;
      if (!isJsonMode()) {
        console.log(colors.green(`✓ Removed Docker image: ${imageTag}`));
      }
    } catch (error) {
      // Image might not exist, which is fine
      if (!isJsonMode()) {
        console.log(
          colors.yellow(`⚠ Could not remove Docker image: ${imageTag}`)
        );
      }
    }
  }

  // Reset config if requested
  if (options.resetConfig) {
    try {
      if (imageTag) {
        projectConfig.setAgentImage(undefined);
      }
      if (projectConfig.generatedFrom) {
        projectConfig.setGeneratedFrom(undefined);
      }
      if (projectConfig.skipPackageInstall) {
        projectConfig.setSkipPackageInstall(false);
      }
      if (projectConfig.preinstalledAgents) {
        projectConfig.setPreinstalledAgents(undefined);
      }
      result.configReset = true;
      if (!isJsonMode()) {
        console.log(colors.green('✓ Reset image configuration in rover.json'));
      }
    } catch (error) {
      return exitWithError({
        success: false,
        error: `Failed to reset configuration: ${error}`,
      });
    }
  }

  return exitWithSuccess(isJsonMode() ? null : 'Clean complete', result);
}

const cleanCmd: CommandDefinition = {
  name: 'clean',
  parent: 'image',
  description: 'Remove Dockerfile.rover and optionally the image',
  requireProject: true,
  action: cleanAction,
};

export default cleanCmd;
