import { registerContextProvider } from '../registry.js';
import { LocalFileProvider } from './local-file.js';

// Re-export providers for direct access
export { LocalFileProvider } from './local-file.js';

/**
 * Register all built-in context providers.
 * Call this at application startup.
 */
export function registerBuiltInProviders(): void {
  registerContextProvider('file', LocalFileProvider);
  // GitHubProvider: see task #486
}
