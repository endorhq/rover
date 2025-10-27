// Check for true color support
export const supportsTrueColor = (): boolean => {
  return !!(
    process.env.COLORTERM === 'truecolor' ||
    process.env.TERM_PROGRAM === 'iTerm.app' ||
    process.env.TERM_PROGRAM === 'vscode' ||
    process.env.TERM === 'xterm-256color' ||
    process.env.TERM === 'tmux-256color' ||
    process.env.FORCE_COLOR === '3'
  );
};

// Create RGB color function
export const rgb = (r: number, g: number, b: number, text: string): string => {
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
};

/**
 * Strip ANSI escape codes from a string to get its visible length
 * @param str - String that may contain ANSI color codes
 * @returns String with ANSI codes removed
 */
export const stripAnsi = (str: string): string => {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
};
