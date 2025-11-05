/**
 * Helper functions for working with iteration configurations.
 * These functions depend on TaskDescription and are kept in the CLI package.
 */
import colors from 'ansi-colors';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TaskDescription } from './description.js';
import { VERBOSE } from 'rover-common';
import { IterationManager } from 'rover-schemas';

/**
 * Load all the iterations for a given task
 */
export const getTaskIterations = (
  task: TaskDescription
): IterationManager[] => {
  const iterations: IterationManager[] = [];
  const iterationsPath = task.iterationsPath();

  if (existsSync(iterationsPath)) {
    try {
      const iterationsIds = readdirSync(iterationsPath, {
        withFileTypes: true,
      })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => parseInt(dirent.name, 10))
        .filter(num => !isNaN(num))
        .sort((a, b) => b - a); // Sort descending to get latest first

      iterationsIds.forEach(id => {
        try {
          iterations.push(
            IterationManager.load(join(iterationsPath, id.toString()))
          );
        } catch (err) {
          // For now, just logging
          if (VERBOSE) {
            console.error(
              colors.gray(
                `Error loading iteration ${id} for task ${task.id}: ` + err
              )
            );
          }
        }
      });
    } catch (err) {
      if (VERBOSE) {
        console.error(
          colors.gray(`Error retrieving iterations for task ${task.id}: ` + err)
        );
      }

      throw new Error('There was an error retrieving the task iterations');
    }
  }

  return iterations;
};

/**
 * Retrieve the lastest iteration for a given task
 */
export const getLastTaskIteration = (
  task: TaskDescription
): IterationManager | undefined => {
  let taskIteration: IterationManager | undefined;
  const iterationsPath = task.iterationsPath();

  if (existsSync(iterationsPath)) {
    try {
      const iterationsIds = readdirSync(iterationsPath, {
        withFileTypes: true,
      })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => parseInt(dirent.name, 10))
        .filter(num => !isNaN(num))
        .sort((a, b) => b - a); // Sort descending to get latest first

      if (iterationsIds.length > 0) {
        taskIteration = IterationManager.load(
          join(iterationsPath, iterationsIds[0].toString())
        );
      } else {
        if (VERBOSE) {
          console.error(
            colors.gray(`Did not find any iteration for task ${task.id}`)
          );
        }
      }
    } catch (err) {
      if (VERBOSE) {
        console.error(
          colors.gray(`Error retrieving iterations for task ${task.id}: ` + err)
        );
      }

      throw new Error('There was an error retrieving the task iterations');
    }
  }

  return taskIteration;
};
