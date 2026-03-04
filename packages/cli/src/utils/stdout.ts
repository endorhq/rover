/**
 * Utility functions for stdout / TTY detection
 */

/**
 * Check if stdout is a TTY (interactive terminal).
 * When false, stdout is piped or redirected (e.g. to another process or file).
 */
export const isStdoutTTY = (): boolean => {
  return process.stdout.isTTY === true;
};

/**
 * Check if stdout is being piped or redirected.
 * Use this when output should be content-only (no banners, boxes, or decorations).
 */
export const isStdoutPiped = (): boolean => {
  return !isStdoutTTY();
};
