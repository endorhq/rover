/**
 * Format an unknown error into a human-readable string.
 * Handles Error instances, plain strings, plain objects (e.g. JSON-RPC errors), and primitives.
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error !== null && typeof error === 'object') {
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }
  return String(error);
}
