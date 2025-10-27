import colors from 'ansi-colors';
import { stripAnsi } from './utils.js';

/**
 * Display a section title with bold cyan text and a line break before
 *
 * Example output:
 * ```
 *
 * Title
 * -----
 * ```
 *
 * @param title - The title text to display
 */
export const showTitle = (title: string): void => {
  console.log();
  console.log(colors.bold(colors.cyan(title)));
  const visibleLength = stripAnsi(title).length;
  console.log(colors.gray('-'.repeat(visibleLength)));
};
