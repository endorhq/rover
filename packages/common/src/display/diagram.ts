import boxen from 'boxen';
import type { DiagramOptions, DiagramStep } from './types.js';
import { stripAnsi } from './utils.js';

/**
 * Calculate the required width for a box based on its title and content
 */
const calculateBoxWidth = (step: DiagramStep): number => {
  // Calculate width needed for title (adding space for " " prefix in boxen title)
  const titleWidth = stripAnsi(step.title).length + 2; // +2 for space before title

  // Calculate width needed for content (each item)
  const contentWidth = step.items.reduce((max, item) => {
    const itemLength = stripAnsi(item).length;
    return Math.max(max, itemLength);
  }, 0);

  // Add padding (1 left + 1 right) and borders (1 left + 1 right)
  // Total extra width: 4 characters
  const boxWidth = Math.max(titleWidth, contentWidth) + 4;

  return boxWidth;
};

/**
 * Display a vertical diagram showing connected steps in a process
 *
 * Example output:
 * ```
 *┌ Context Analysis ──────────┐
 *│ • context.md               │
 *└────────────────────────────┘
 *             ↓
 *┌ Outline ───────────────────┐
 *│ • outline.md               │
 *└────────────────────────────┘
 *             ↓
 *┌ Draft ─────────────────────┐
 *│ • draft.md                 │
 *└────────────────────────────┘
 *             ↓
 *┌ Review ────────────────────┐
 *│ • docs.md                  │
 *│ • summary.md               │
 *└────────────────────────────┘
 * ```
 *
 * @param steps - Array of diagram steps, each with a title and items
 * @param options - Optional configuration for the diagram display
 */
export const showDiagram = (
  steps: DiagramStep[],
  options?: DiagramOptions
): void => {
  // Add line break before if requested
  if (options?.addLineBreak) {
    console.log();
  }

  // Handle empty steps array
  if (steps.length === 0) {
    return;
  }

  const maxWidth = options?.maxWidth ?? 80;

  // Calculate the width needed for each step
  const stepWidths = steps.map(step => calculateBoxWidth(step));

  // Find the biggest required width
  const biggestBoxSize = Math.max(...stepWidths);

  // Use the minimum of biggestBoxSize and maxWidth
  const uniformWidth = Math.min(biggestBoxSize, maxWidth);

  // Display each step
  steps.forEach((step, index) => {
    // Build the content for the box
    const content = step.items.join('\n');

    // Create the box
    const box = boxen(content, {
      title: step.title,
      titleAlignment: 'left',
      borderStyle: 'round',
      padding: {
        top: 0,
        bottom: 0,
        left: 1,
        right: 1,
      },
      width: uniformWidth,
    });

    // Display the box
    console.log(box);

    // Add arrow between steps (but not after the last one)
    if (index < steps.length - 1) {
      // Calculate the width of the box to center the arrow
      const boxLines = box.split('\n');
      const firstLine = boxLines[0];
      const boxWidth = stripAnsi(firstLine).length;
      const arrowPadding = Math.floor(boxWidth / 2);

      console.log(' '.repeat(arrowPadding) + '\u2193'); // Unicode downward arrow ↓
    }
  });
};
