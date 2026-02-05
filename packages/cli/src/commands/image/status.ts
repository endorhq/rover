/**
 * rover image status - Show custom image status and check for updates
 *
 * This command displays information about the custom image configuration
 * and detects if it needs to be rebuilt.
 */

import colors from 'ansi-colors';
import { ProjectConfigManager } from 'rover-core';
import {
  checkImageStatus,
  formatImageStatus,
  type ImageStatus,
} from '../../lib/image-status.js';
import { getProjectPath, isJsonMode } from '../../lib/context.js';
import { exitWithError, exitWithSuccess } from '../../utils/exit.js';
import type { CommandDefinition } from '../../types.js';

interface StatusOptions {
  json?: boolean;
}

interface StatusResult {
  success: boolean;
  status: ImageStatus;
  customImage?: string;
  error?: string;
}

async function statusAction(options: StatusOptions): Promise<void> {
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

  const status = checkImageStatus(projectConfig);
  const customImage = projectConfig.agentImage;

  if (options.json || isJsonMode()) {
    const result: StatusResult = {
      success: true,
      status,
      customImage,
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  // Display human-readable output
  if (customImage) {
    console.log(colors.cyan(`Custom image: ${customImage}`));
  }

  console.log(formatImageStatus(status));

  // Set exit code based on status
  if (status.status === 'outdated') {
    process.exit(1);
  }

  process.exit(0);
}

const statusCmd: CommandDefinition = {
  name: 'status',
  parent: 'image',
  description: 'Show image state and check for updates',
  requireProject: true,
  action: statusAction,
};

export default statusCmd;
