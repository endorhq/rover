/**
 * Display utilities for consistent CLI output
 *
 * This module provides reusable display methods following the CLI guidelines
 * documented in docs/cli-guidelines.md
 */

// Export header utilities
export { showSplashHeader, showRegularHeader } from './header.js';

// Export title utilities
export { showTitle } from './title.js';

// Export file content utilities
export { showFile } from './content.js';

// Export tips utilities
export { showTips, showTip } from './tips.js';

// Export list utilities
export { showList } from './list.js';

// Export properties utilities
export { showProperties } from './properties.js';

// Export process utilities
export { ProcessManager } from './process.js';

// Export utility functions
export { stripAnsi } from './utils.js';

// Export types
export type {
  DisplayColor,
  TipsOptions,
  ProcessItemStatus,
  ProcessItem,
  ProcessOptions,
  ListOptions,
  PropertiesOptions,
} from './types.js';
