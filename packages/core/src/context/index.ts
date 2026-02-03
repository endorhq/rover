// Types
export type {
  ContextEntry,
  ContextProvider,
  ContextProviderClass,
  ProviderOptions,
  BaseContextMetadata,
  IssueMetadata,
  PRMetadata,
  PRDiffMetadata,
  FileMetadata,
  HTTPSResourceMetadata,
  ContextMetadata,
} from './types.js';

// Errors
export {
  ContextError,
  ContextSchemeNotSupportedError,
  ContextUriParseError,
  ContextTypeNotSupportedError,
  ContextFetchError,
} from './errors.js';

// Registry
export {
  registerContextProvider,
  createContextProvider,
  isContextSchemeSupported,
  getRegisteredSchemes,
  clearContextProviders,
} from './registry.js';

// Providers
export {
  registerBuiltInProviders,
  LocalFileProvider,
  GitHubProvider,
  HTTPSProvider,
} from './providers/index.js';
