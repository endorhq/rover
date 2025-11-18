/**
 * Global state for CLI execution.
 * This module stores runtime flags that need to be accessible throughout the application.
 */

let _isJsonMode = false;

/**
 * Set whether the CLI is running in JSON output mode.
 * This should be called early in the program execution (e.g., in preAction hooks).
 */
export function setJsonMode(value: boolean): void {
  _isJsonMode = value;
}

/**
 * Check if the CLI is running in JSON output mode.
 * When in JSON mode, human-readable console output should be suppressed.
 */
export function isJsonMode(): boolean {
  return _isJsonMode;
}
