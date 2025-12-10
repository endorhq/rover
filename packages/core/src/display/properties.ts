import colors from 'ansi-colors';
import type { PropertiesOptions } from './types.js';

/**
 * Display properties in a list format
 *
 * Guidelines:
 * - A title + description set of related elements
 * - Show titles using gray text, values in white (default color - no color applied)
 * - Prefix list items with the `·` symbol
 * - For multiline values, use the `|` decorator on the property name
 *
 * Example output:
 * ```
 * · ID: 76
 * · Title: Update the AGENTS.md file.
 * · Description: |
 *   This is a longer value that might spawn multiple lines.
 *   We show it using the | decorator on the property name.
 * ```
 *
 * @param properties - Map or Record of property key-value pairs
 * @param options - Display options
 */
export function showProperties(
  properties: Map<string, string> | Record<string, string>,
  options: PropertiesOptions = {}
): void {
  const { addLineBreak = false } = options;

  if (addLineBreak) {
    console.log();
  }

  // Convert to array of entries for consistent handling
  const entries =
    properties instanceof Map
      ? Array.from(properties.entries())
      : Object.entries(properties);

  for (const [key, value] of entries) {
    // Check if value contains newlines (multiline)
    const isMultiline = value.includes('\n');

    if (isMultiline) {
      // Display with | decorator
      console.log(
        `${colors.gray('·')} ${colors.gray(key)}: ${colors.gray('|')}`
      );

      // Split value into lines and indent them
      const lines = value.split('\n');
      for (const line of lines) {
        console.log(`  ${line}`);
      }
    } else {
      // Display single line
      console.log(`${colors.gray('·')} ${colors.gray(key)}: ${value}`);
    }
  }
}
