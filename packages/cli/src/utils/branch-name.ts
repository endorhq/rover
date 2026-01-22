import { generateRandomId } from 'rover-core';

// Re-export generateRandomId for backward compatibility
export { generateRandomId };

/**
 * Generate a unique branch name for a task
 * Format: rover/task-{TASK_ID}-{NANOID_RANDOM_STRING}
 */
export function generateBranchName(taskId: number): string {
  const randomId = generateRandomId();
  return `rover/task-${taskId}-${randomId}`;
}
