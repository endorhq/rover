import colors from 'ansi-colors';
import type { TipsOptions } from './types.js';

/**
 * Display tips to help users understand next steps or related actions
 *
 * Guidelines:
 * - Show only 1-2 tips maximum
 * - Keep tip messages concise
 * - Display tips at the bottom of command output
 * - Skip tips if alternative actions are not clearly relevant
 *
 * Example output:
 * ```
 *
 * Tip: run `rover logs 12` to check logs
 * ```
 *
 * @param tips - Single tip string or array of tips (max 2 recommended)
 * @param options - Display options
 */
export function showTips(
  tips: string | string[],
  options: TipsOptions = {}
): void {
  const { addLineBreak = true } = options;

  // Normalize to array
  const tipArray = Array.isArray(tips) ? tips : [tips];

  // Limit to 2 tips as per guidelines
  const displayTips = tipArray.slice(0, 2);

  if (addLineBreak) {
    console.log();
  }

  for (const tip of displayTips) {
    const tipPrefix = colors.cyan('Tip:');
    const tipMessage = colors.gray(` ${tip}`);
    console.log(`${tipPrefix}${tipMessage}`);
  }
}

/**
 * Convenience function to display a single tip
 *
 * @param tip - The tip message to display
 */
export function showTip(tip: string): void {
  showTips(tip);
}
