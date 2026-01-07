/**
 * Task lifecycle hooks library
 * Executes user-configured hook commands when tasks are merged or pushed
 */

import colors from 'ansi-colors';
import { launchSync } from 'rover-core';
import { isJsonMode } from './global-state.js';

/**
 * Context passed to hooks via environment variables
 */
export interface HookContext {
  /** The task ID */
  taskId: number;
  /** The task branch name */
  taskBranch: string;
  /** The task title */
  taskTitle: string;
  /** The task status (for onComplete hooks: 'completed' or 'failed') */
  taskStatus?: string;
}

/**
 * Result of executing a hook command
 */
export interface HookResult {
  /** The command that was executed */
  command: string;
  /** Whether the hook succeeded */
  success: boolean;
  /** Warning message if the hook failed */
  warning?: string;
}

/**
 * Execute a single hook command with task context.
 * Hook failures are caught and returned as warnings, never throwing.
 *
 * @param command The shell command to execute
 * @param context Task context passed via environment variables
 * @returns HookResult with success status and optional warning
 */
export function executeHook(command: string, context: HookContext): HookResult {
  try {
    // Prepare environment variables with ROVER_ prefix
    const env = {
      ...process.env,
      ROVER_TASK_ID: context.taskId.toString(),
      ROVER_TASK_BRANCH: context.taskBranch,
      ROVER_TASK_TITLE: context.taskTitle,
      ...(context.taskStatus && { ROVER_TASK_STATUS: context.taskStatus }),
    };

    // Execute the command synchronously using launchSync
    launchSync('sh', ['-c', command], {
      env,
      stdio: 'pipe',
    });

    return {
      command,
      success: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      command,
      success: false,
      warning: `Hook command failed: ${command} - ${errorMessage}`,
    };
  }
}

/**
 * Execute multiple hook commands sequentially.
 * Logs warnings for any failures but continues executing remaining hooks.
 *
 * @param commands Array of shell commands to execute
 * @param context Task context passed to each hook
 * @param hookType Type of hook for logging purposes (e.g., 'onMerge', 'onPush')
 * @returns Array of HookResults
 */
export function executeHooks(
  commands: string[],
  context: HookContext,
  hookType: string
): HookResult[] {
  const results: HookResult[] = [];

  for (const command of commands) {
    const result = executeHook(command, context);
    results.push(result);

    // Log warning if hook failed (only in non-JSON mode)
    if (!result.success && !isJsonMode()) {
      console.log(
        colors.yellow(`⚠ ${hookType} hook warning: ${result.warning}`)
      );
    }
  }

  return results;
}
