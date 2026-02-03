import { registerContextProvider } from '../registry.js';
import { LocalFileProvider } from './local-file.js';
import { GitHubProvider } from './github.js';

// Re-export providers for direct access
export { LocalFileProvider } from './local-file.js';
export { GitHubProvider } from './github.js';

/**
 * Register all built-in context providers.
 * Call this at application startup.
 */
export function registerBuiltInProviders(): void {
  registerContextProvider('file', LocalFileProvider);
  registerContextProvider('github', GitHubProvider);
}
