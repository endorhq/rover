import colors from 'ansi-colors';
import { rgb, supportsTrueColor } from './utils.js';

/**
 * Show the Rover logo
 */
export const showSplashHeader = () => {
  const bannerText = [
    '▗▄▄▖  ▗▄▖ ▗▖  ▗▖▗▄▄▄▖▗▄▄▖ ',
    '▐▌ ▐▌▐▌ ▐▌▐▌  ▐▌▐▌   ▐▌ ▐▌',
    '▐▛▀▚▖▐▌ ▐▌▐▌  ▐▌▐▛▀▀▘▐▛▀▚▖',
    '▐▌ ▐▌▝▚▄▞▘ ▝▚▞▘ ▐▙▄▄▖▐▌ ▐▌',
  ];

  let banner;

  if (supportsTrueColor()) {
    // True color teal gradient from top to bottom (vertical)
    const colorSteps = [
      [94, 234, 212], // Teal 300 - top
      [45, 212, 191], // Teal 400
      [20, 184, 166], // Teal 500
      [13, 148, 136], // Teal 600 - bottom
    ];

    banner = bannerText
      .map((line, lineIndex) => {
        // Apply color based on line index (vertical gradient)
        const colorIndex = Math.min(lineIndex, colorSteps.length - 1);
        const [r, g, b] = colorSteps[colorIndex];

        // Apply the same color to all characters in the line
        return line
          .split('')
          .map(char => rgb(r, g, b, char))
          .join('');
      })
      .join('\n');
  } else {
    // Fallback to simple cyan
    banner = bannerText.map(line => colors.cyan(line)).join('\n');
  }

  console.log(banner);
};

/**
 * Display a regular header showing CLI name, version, and context
 *
 * Example output:
 * ```
 * Rover (v1.3.0) · /home/user/workspace/project
 * ---------------------------------------------
 * ```
 *
 * @param version - Version string (e.g., "1.3.0")
 * @param context - Context path (e.g., current working directory)
 */
export function showRegularHeader(version: string, context: string): void {
  const headerText = `${colors.cyan('Rover')} ${colors.gray(`(v${version})`)} · ${colors.gray(context)}`;
  const separator = colors.gray('-'.repeat(headerText.length));

  console.log(headerText);
  console.log(separator);
}
