import colors from 'ansi-colors';
import { rgb, supportsTrueColor } from './utils.js';

export interface RoverHeaderOptions {
  version: string;
  agent: string;
  defaultAgent?: boolean;
  projectPath: string;
  projectName?: string;
}

/**
 * Display a consolidated Rover header with ASCII art and project information
 *
 * Example output:
 * ```
 *  ╭════╮   Rover · v1.3.0
 * ▌│ ██ │▐  Claude
 *  ╰════╯   ◈ my-project /home/user/workspace/project
 * ```
 *
 * @param options - Header display options
 */
export function showRoverHeader(options: RoverHeaderOptions): void {
  const { version, agent, defaultAgent, projectPath, projectName } = options;

  // ASCII art lines (3 lines)
  const asciiArt = [' ╭════╮  ', '❙│ ██ │❙ ', ' ╰════╯  '];

  // Text lines (3 lines)
  const lines = [];
  lines.push(`Rover · ${colors.gray(`v${version}`)}`);
  lines.push(
    defaultAgent
      ? `${agent} ${colors.gray('(default)')}`
      : `${agent} ${colors.gray('(selected)')}`
  );

  if (projectName) {
    lines.push(
      `${colors.cyan('◈')} ${colors.cyan(projectName)} ${colors.gray(projectPath)}`
    );
  } else {
    lines.push(
      `${colors.yellow('◇')} ${colors.yellow('No Project')} ${colors.gray(projectPath)}`
    );
  }

  // Breakline
  console.log();

  // Combine ASCII art with text lines
  if (supportsTrueColor()) {
    const t600 = [13, 148, 136];
    const t400 = [45, 212, 191];

    const coloredAsciiArt = [
      rgb(t600[0], t600[1], t600[2], asciiArt[0]),
      `${rgb(t600[0], t600[1], t600[2], '❙│ ')}${rgb(t400[0], t400[1], t400[2], '██')}${rgb(t600[0], t600[1], t600[2], ' │❙ ')}`,
      rgb(t600[0], t600[1], t600[2], asciiArt[2]),
    ];

    for (let i = 0; i < asciiArt.length; i++) {
      console.log(` ${coloredAsciiArt[i]} ${lines[i]}`);
    }
  } else {
    // Fallback to simple cyan
    for (let i = 0; i < asciiArt.length; i++) {
      console.log(` ${colors.cyan(asciiArt[i])} ${lines[i]}`);
    }
  }
}
