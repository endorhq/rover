import colors from 'ansi-colors';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  getDataDir,
  ProjectStore,
  showList,
  showProperties,
  showTitle,
} from 'rover-core';
import { isJsonMode } from '../lib/context.js';
import { getTelemetry } from '../lib/telemetry.js';
import type { InfoCommandOutput, ProjectInfo } from '../output-types.js';
import { exitWithError, exitWithSuccess } from '../utils/exit.js';
import type { CommandDefinition } from '../types.js';

/**
 * Count tasks for a project by looking at the tasks directory
 */
function countProjectTasks(projectsPath: string, projectId: string): number {
  const tasksPath = join(projectsPath, projectId, 'tasks');

  if (!existsSync(tasksPath)) {
    return 0;
  }

  try {
    const entries = readdirSync(tasksPath, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

/**
 * Display information about the Rover global store.
 *
 * Shows the location of the Rover data directory and lists all registered
 * projects with their IDs, paths, and task counts. This is useful for
 * understanding the global Rover state and debugging project registration.
 *
 * @param _options - Command options
 * @param _options.json - Output results in JSON format
 */
const infoCommand = async (_options: { json?: boolean } = {}) => {
  const storePath = getDataDir();
  const jsonOutput: InfoCommandOutput = {
    success: true,
    storePath,
    projectCount: 0,
    projects: [],
  };

  const telemetry = getTelemetry();
  telemetry?.eventInfo();

  try {
    const store = new ProjectStore();
    const projectsPath = store.getProjectsPath();

    // Get projects to display
    let projectsToShow = store.list();

    // Build project info array
    const projectInfos: ProjectInfo[] = projectsToShow.map(project => {
      const taskCount = countProjectTasks(projectsPath, project.id);

      return {
        id: project.id,
        name: project.repositoryName,
        path: project.path,
        taskCount,
      };
    });

    // Build output
    jsonOutput.projectCount = projectInfos.length;
    jsonOutput.projects = projectInfos;

    if (!isJsonMode()) {
      // Human-readable output
      showTitle('Rover Store Information');

      showProperties({
        'Store Path': storePath,
        'Registered Projects': projectInfos.length.toString(),
      });

      if (projectInfos.length > 0) {
        showTitle('Projects');

        for (const project of projectInfos) {
          showList(
            [
              `ID: ${project.id}`,
              `Path: ${project.path}`,
              `Tasks: ${project.taskCount}`,
            ],
            {
              title: colors.cyan(project.name),
              addLineBreak: true,
            }
          );
        }
      } else {
        console.log(colors.gray('\n  No projects registered yet.'));
      }
    }

    // Exit
    await exitWithSuccess(null, jsonOutput, { telemetry });
  } catch (error) {
    jsonOutput.success = false;
    jsonOutput.error = error instanceof Error ? error.message : String(error);
    await exitWithError(jsonOutput, { telemetry });
  }
};

// Named export for backwards compatibility (used by tests)
export { infoCommand };

export default {
  name: 'info',
  description: 'Show information about the Rover global store',
  requireProject: false,
  action: infoCommand,
} satisfies CommandDefinition;
