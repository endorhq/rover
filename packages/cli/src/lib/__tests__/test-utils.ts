/**
 * Test utilities for CLI context.
 *
 * Note: Context is automatically initialized and reset by test-setup.ts.
 * These exports are for tests that need to override the default context.
 */
export {
  initCLIContext,
  resetCLIContext,
  type CLIContext,
} from '../context.js';
