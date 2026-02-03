/**
 * Result entry from a context provider's build() method.
 * Each entry represents a piece of context to be stored.
 */
export type ContextEntry = {
  /** Display name, e.g., "GitHub Issue #15" */
  name: string;

  /** Short description for index.md manifest */
  description: string;

  /** Storage filename, e.g., "github-issue-15.json" */
  filename: string;

  /** The actual content (stringified JSON, markdown, text). Optional when filepath is provided. */
  content?: string;

  /** Path to the file on disk. Used for local file references. */
  filepath?: string;

  /** Original URI for provenance tracking */
  source: string;

  /** Timestamp when content was fetched */
  fetchedAt: Date;
};

/**
 * Options passed to provider constructors.
 */
export type ProviderOptions = {
  /** Trust specific authors for comment inclusion */
  trustAuthors?: string[];

  /** Trust all authors (skip comment filtering) */
  trustAllAuthors?: boolean;

  /** Current working directory for resolving relative paths */
  cwd?: string;

  /**
   * Original URI string before URL parsing.
   * Automatically set by createContextProvider().
   */
  originalUri?: string;
};

/**
 * Interface that all context providers must implement.
 */
export interface ContextProvider {
  /** The URI scheme this provider handles (e.g., "github", "file") */
  readonly scheme: string;

  /** Types this provider supports for validation (e.g., ["issue", "pr"]) */
  readonly supportedTypes: string[];

  /** The original URI passed to the constructor */
  readonly uri: string;

  /**
   * Fetch content and build context entries.
   * @throws ContextFetchError on network/fetch failures
   */
  build(): Promise<ContextEntry[]>;
}

/**
 * Constructor signature for provider classes.
 * Receives a parsed URL object (original URI available via url.href).
 */
export type ContextProviderClass = new (
  url: URL,
  options?: ProviderOptions
) => ContextProvider;
