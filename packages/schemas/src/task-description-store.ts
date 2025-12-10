/**
 * TaskDescriptionStore - Helper class for retrieving all task descriptions
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot, VERBOSE } from 'rover-core';
import colors from 'ansi-colors';
import { TaskDescriptionManager } from './task-description.js';

/**
 * Store for managing collections of task descriptions
 */
export class TaskDescriptionStore {
  /**
   * Retrieves all task descriptions from the tasks directory
   */
  static getAllDescriptions(): TaskDescriptionManager[] {
    const tasks: TaskDescriptionManager[] = [];

    try {
      const roverPath = join(findProjectRoot(), '.rover');
      const tasksPath = join(roverPath, 'tasks');

      if (existsSync(tasksPath)) {
        const taskIds = readdirSync(tasksPath, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory())
          .map(dirent => parseInt(dirent.name, 10))
          .filter(name => !isNaN(name)) // Only numeric task IDs
          .sort((a, b) => b - a); // Sort descending

        taskIds.forEach(id => {
          try {
            tasks.push(TaskDescriptionManager.load(id));
          } catch (err) {
            if (VERBOSE) {
              console.error(colors.gray(`Error loading task ${id}: ` + err));
            }
          }
        });
      }
    } catch (err) {
      if (VERBOSE) {
        console.error(colors.gray('Error retrieving descriptions: ' + err));
      }

      throw new Error('There was an error retrieving the task descriptions');
    }

    return tasks;
  }
}
