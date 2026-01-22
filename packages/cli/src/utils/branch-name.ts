import { generateRandomId } from 'rover-core';

/**
 * Generate a unique branch name for a task
 * Format: rover/task-{TASK_ID}-{NANOID_RANDOM_STRING}
 */
export function generateBranchName(taskId: number): string {
  const randomId = generateRandomId();
  return `rover/task-${taskId}-${randomId}`;
}
