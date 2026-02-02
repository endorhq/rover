import type {
  ContextProvider,
  ContextProviderClass,
  ProviderOptions,
} from './types.js';
import {
  ContextSchemeNotSupportedError,
  ContextUriParseError,
} from './errors.js';

// Private registry map
const providers = new Map<string, ContextProviderClass>();

/**
 * Register a context provider for a given scheme.
 * @param scheme - The URI scheme (e.g., "github", "file")
 * @param providerClass - The provider class constructor
 */
export function registerContextProvider(
  scheme: string,
  providerClass: ContextProviderClass
): void {
  providers.set(scheme, providerClass);
}

/**
 * Check if a scheme has a registered provider.
 * @param scheme - The URI scheme to check
 */
export function isContextSchemeSupported(scheme: string): boolean {
  return providers.has(scheme);
}

/**
 * Get all registered schemes.
 */
export function getRegisteredSchemes(): string[] {
  return Array.from(providers.keys());
}

/**
 * Create a context provider instance for the given URI.
 *
 * @param uri - The context URI (e.g., "github:issue/15", "file:./test.md")
 * @param options - Provider options (trust settings, cwd, etc.)
 * @throws ContextUriParseError if URI is malformed
 * @throws ContextSchemeNotSupportedError if scheme has no registered provider
 */
export function createContextProvider(
  uri: string,
  options?: ProviderOptions
): ContextProvider {
  // Parse URI using built-in URL API
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new ContextUriParseError(uri, 'Not a valid URI');
  }

  // Extract scheme (URL.protocol includes trailing colon)
  const scheme = url.protocol.slice(0, -1);

  // Lookup provider
  const ProviderClass = providers.get(scheme);
  if (!ProviderClass) {
    throw new ContextSchemeNotSupportedError(scheme);
  }

  // Instantiate provider with parsed URL (original URI available via url.href)
  return new ProviderClass(url, options);
}

/**
 * Clear all registered providers. Useful for testing.
 */
export function clearContextProviders(): void {
  providers.clear();
}
