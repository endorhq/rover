/**
 * Base error for context provider operations.
 */
export class ContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextError';
  }
}

/**
 * Thrown when a URI scheme is not registered.
 */
export class ContextSchemeNotSupportedError extends ContextError {
  constructor(public readonly scheme: string) {
    super(`Unsupported context scheme: "${scheme}"`);
    this.name = 'ContextSchemeNotSupportedError';
  }
}

/**
 * Thrown when a URI is malformed or invalid.
 */
export class ContextUriParseError extends ContextError {
  constructor(
    public readonly uri: string,
    reason: string
  ) {
    super(`Invalid context URI "${uri}": ${reason}`);
    this.name = 'ContextUriParseError';
  }
}

/**
 * Thrown when a provider doesn't support the requested type.
 */
export class ContextTypeNotSupportedError extends ContextError {
  constructor(
    public readonly scheme: string,
    public readonly type: string,
    public readonly supportedTypes: string[]
  ) {
    super(
      `Provider "${scheme}" does not support type "${type}". ` +
        `Supported types: ${supportedTypes.join(', ')}`
    );
    this.name = 'ContextTypeNotSupportedError';
  }
}

/**
 * Thrown when build() fails to fetch content.
 */
export class ContextFetchError extends ContextError {
  constructor(
    public readonly uri: string,
    public readonly reason: string
  ) {
    super(`Failed to fetch context from "${uri}": ${reason}`);
    this.name = 'ContextFetchError';
  }
}
