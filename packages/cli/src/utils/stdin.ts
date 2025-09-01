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

    // Check if there's actually data available on stdin
    if (process.stdin.isTTY) {
      // If stdin is a TTY, there's no piped input
      resolve(null);
      return;
    }

    process.stdin.setEncoding('utf8');

    // Check if the data is available already
    const chunk = process.stdin.read();

    if (chunk != null) {
      // Return the data instantly
      resolve(chunk.trim() || null);
    } else {
      // Wait for the event with a timeout
      const timeout = setTimeout(() => {
        resolve(null);
      }, 200); // ms timeout

      process.stdin.once('readable', () => {
        let chunk;
        while ((chunk = process.stdin.read()) !== null) {
          input += chunk;
        }
      });

      process.stdin.on('end', () => {
        clearTimeout(timeout);
        resolve(input.trim() || null);
      });

      process.stdin.on('error', err => {
        clearTimeout(timeout);
        resolve(null);
      });
    }
  });
};

/**
 * Checks if stdin has data available (piped input)
 */
export const stdinIsAvailable = (): boolean => {
  return !process.stdin.isTTY;
};
