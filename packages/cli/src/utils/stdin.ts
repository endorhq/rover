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

        // Set up timeout to avoid hanging
        const timeout = setTimeout(() => {
            resolve(null);
        }, 1000); // 1 second timeout

        process.stdin.setEncoding('utf8');

        process.stdin.on('readable', () => {
            let chunk;
            while ((chunk = process.stdin.read()) !== null) {
                input += chunk;
            }
        });

        process.stdin.on('end', () => {
            clearTimeout(timeout);
            resolve(input.trim() || null);
        });

        process.stdin.on('error', (err) => {
            clearTimeout(timeout);
            resolve(null);
        });

        // Try to read immediately in case data is already available
        const chunk = process.stdin.read();
        if (chunk !== null) {
            input += chunk;
            clearTimeout(timeout);
            resolve(input.trim() || null);
        }
    });
};

/**
 * Checks if stdin has data available (piped input)
 */
export const stdinIsAvailable = (): boolean => {
    return !process.stdin.isTTY;
};