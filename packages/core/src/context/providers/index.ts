import { registerContextProvider } from '../registry.js';
import { LocalFileProvider } from './local-file.js';
import { GitHubProvider } from './github.js';
import { GitLabProvider } from './gitlab.js';
import { HTTPSProvider } from './https.js';

// Re-export providers for direct access
export { LocalFileProvider } from './local-file.js';
export { GitHubProvider } from './github.js';
export { GitLabProvider } from './gitlab.js';
export { HTTPSProvider } from './https.js';

/**
 * Register all built-in context providers.
 * Call this at application startup.
 */
export function registerBuiltInProviders(): void {
  registerContextProvider('file', LocalFileProvider);
  registerContextProvider('github', GitHubProvider);
  registerContextProvider('gitlab', GitLabProvider);
  registerContextProvider('https', HTTPSProvider);
  registerContextProvider('http', HTTPSProvider); // http upgrades to https
}
