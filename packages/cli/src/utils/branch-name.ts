import { customAlphabet } from 'nanoid';

const CUSTOM_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-';
const NANOID_SIZE = 12;

const generateRandomId = customAlphabet(CUSTOM_ALPHABET, NANOID_SIZE);

/**
 * Generate a unique branch name for a task
 * Format: rover/task-{TASK_ID}-{NANOID_RANDOM_STRING}
 */
export function generateBranchName(taskId: number): string {
    const randomId = generateRandomId();
    return `rover/task-${taskId}-${randomId}`;
}