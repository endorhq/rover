import colors from 'ansi-colors';

/**
 * Display a unified diff with syntax highlighting.
 *
 * Colors each line based on its diff prefix:
 * - `@@` hunk headers in magenta
 * - `+` additions in green (excluding `+++` file headers)
 * - `-` deletions in red (excluding `---` file headers)
 * - `diff --git` headers in bold
 * - `index`, `+++`, `---` metadata in gray
 *
 * @param diffOutput - Raw unified diff string
 */
export const showDiff = (diffOutput: string): void => {
  const lines = diffOutput.split('\n');
  for (const line of lines) {
    if (line.startsWith('@@')) {
      console.log(colors.magenta(line));
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      console.log(colors.green(line));
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      console.log(colors.red(line));
    } else if (line.startsWith('diff --git')) {
      console.log(colors.bold(line));
    } else if (
      line.startsWith('index ') ||
      line.startsWith('+++') ||
      line.startsWith('---')
    ) {
      console.log(colors.gray(line));
    } else {
      console.log(line);
    }
  }
};
