/**
 * Vitest setup file for CLI tests.
 * Automatically initializes and resets CLI context for all tests.
 */
import { afterEach, beforeEach } from 'vitest';
import { initCLIContext, resetCLIContext } from './lib/context.js';

/**
 * Default test context - simulates being in a project with JSON mode disabled.
 * Individual tests can override by calling initCLIContext() with different values.
 */
beforeEach(() => {
  initCLIContext({
    jsonMode: false,
    verbose: false,
    project: null,
    inGitRepo: true,
  });
});

afterEach(() => {
  resetCLIContext();
});
