import { generateRandomId } from 'rover-core';

/**
 * Generate a unique branch name for a task
 * Format: rover/task-{TASK_ID}-{NANOID_RANDOM_STRING}
 */
export function generateBranchName(taskId: number): string {
  const randomId = generateRandomId();
  return `rover/task-${taskId}-${randomId}`;
}

/**
 * Parse the task ID from a Rover task branch name.
 * Returns the task ID if the branch matches the pattern, or null otherwise.
 */
export function parseTaskIdFromBranch(branchName: string): number | null {
  const match = branchName.match(/^rover\/task-(\d+)-/);
  if (!match) return null;
  return parseInt(match[1], 10);
}
