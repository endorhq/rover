import type { ListOptions } from './types.js';

/**
 * Display a list of independent elements using tree-style symbols
 *
 * Example output:
 * ```
 * Iteration Files 1/1
 * ├── changes.md
 * ├── context.md
 * ├── plan.md
 * └── summary.md
 * ```
 *
 * @param items - Array of strings to display as list items
 * @param options - Optional configuration for the list display
 */
export const showList = (items: string[], options?: ListOptions): void => {
  // Add line break before if requested
  if (options?.addLineBreak) {
    console.log();
  }

  // Display title if provided
  if (options?.title !== undefined) {
    console.log(options.title);
  }

  // Handle empty arrays
  if (items.length === 0) {
    return;
  }

  // Display list items
  items.forEach((item, index) => {
    const isLast = index === items.length - 1;
    const symbol = isLast ? '└──' : '├──';
    console.log(`${symbol} ${item}`);
  });
};
