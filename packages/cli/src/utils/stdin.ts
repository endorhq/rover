/**
 * Utility functions for reading from stdin
 */

/**
 * Reads input from stdin. Returns null if no input is available.
 * This is a non-blocking check for stdin data.
 */
export const readFromStdin = async (): Promise<string | null> => {
  return new Promise((resolve, reject) => {
    let input = '';
    let resolved = false;

    // Check if there's actually data available on stdin
    if (process.stdin.isTTY) {
      // If stdin is a TTY, there's no piped input
      resolve(null);
      return;
    }

    process.stdin.setEncoding('utf8');

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        process.stdin.removeAllListeners('readable');
        process.stdin.removeAllListeners('end');
        process.stdin.removeAllListeners('error');
      }
    };

    // Check if the data is available already
    let chunk = process.stdin.read();

    // Read all immediately available data
    while (chunk !== null) {
      input += chunk;
      chunk = process.stdin.read();
    }

    // If we got data immediately, return it
    if (input.length > 0) {
      cleanup();
      resolve(input.trim() || null);
      return;
    }

    // Wait for the event with a timeout
    const timeout = setTimeout(() => {
      cleanup();
      // Check if we accumulated any data before timing out
      resolve(input.trim() || null);
    }, 200); // ms timeout

    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        input += chunk;
      }
    });

    process.stdin.on('end', () => {
      clearTimeout(timeout);
      cleanup();
      resolve(input.trim() || null);
    });

    process.stdin.on('error', err => {
      clearTimeout(timeout);
      cleanup();
      resolve(null);
    });
  });
};

/**
 * Checks if stdin has data available (piped input)
 */
export const stdinIsAvailable = (): boolean => {
  return !process.stdin.isTTY;
};

/**
 * Check if the current terminal is interactive.
 * @returns true if stdin is a TTY.
 */
export function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true;
}
