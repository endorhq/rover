type MaybeExecaError = {
  message?: unknown;
  stderr?: unknown;
  shortMessage?: unknown;
};

function toStringPart(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Returns true when container inspect failed because the container does not
 * exist anymore (expected for orphan detection), and false for backend/API
 * failures where state should be treated as unknown.
 */
export function isContainerMissingInspectError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const execaError = error as MaybeExecaError;
  const details = [
    toStringPart(execaError.message),
    toStringPart(execaError.shortMessage),
    toStringPart(execaError.stderr),
  ]
    .join('\n')
    .toLowerCase();

  return (
    details.includes('no such object') ||
    details.includes('no such container') ||
    details.includes('no container with name or id')
  );
}
