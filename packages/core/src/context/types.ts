/**
 * Base metadata interface. All metadata types must have a `type` discriminator.
 * Type values should be namespaced: 'github:issue', 'gitlab:mr', 'file', etc.
 */
export interface BaseContextMetadata {
  type: string;
}

/**
 * Generic metadata for issues (GitHub, GitLab, etc.).
 * Use `type` to distinguish provider: 'github:issue', 'gitlab:issue', etc.
 */
export interface IssueMetadata extends BaseContextMetadata {
  number: number;
  state: string;
  labels: string[];
  assignees: string[];
  milestone?: string;
  author: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Generic metadata for pull/merge requests (GitHub PR, GitLab MR, etc.).
 * Use `type` to distinguish provider: 'github:pr', 'gitlab:mr', etc.
 */
export interface PRMetadata extends BaseContextMetadata {
  number: number;
  state: string;
  headBranch: string;
  baseBranch: string;
  isDraft: boolean;
  mergeable?: boolean;
  labels: string[];
  assignees: string[];
  reviewers: string[];
  author: string;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
  mergedBy?: string;
}

/**
 * Generic metadata for PR/MR diffs.
 * Use `type` to distinguish provider: 'github:pr-diff', 'gitlab:mr-diff', etc.
 */
export interface PRDiffMetadata extends BaseContextMetadata {
  number: number;
  headBranch: string;
  baseBranch: string;
}

/**
 * Metadata for local files.
 */
export interface FileMetadata extends BaseContextMetadata {
  type: 'file';
  absolutePath: string;
  extension: string;
}

/**
 * Metadata for HTTPS resources.
 */
export interface HTTPSResourceMetadata extends BaseContextMetadata {
  type: 'https:resource';
  finalUrl: string;
  contentType?: string;
  isDownloaded: boolean;
  extension: string;
  statusCode: number;
  contentLength?: number;
}

/**
 * Union of all known metadata types.
 * Use type guards to narrow: `if (metadata.type === 'github:pr') { ... }`
 */
export type ContextMetadata =
  | IssueMetadata
  | PRMetadata
  | PRDiffMetadata
  | FileMetadata
  | HTTPSResourceMetadata
  | BaseContextMetadata; // Fallback for unknown/custom types

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

  /** Provider-specific metadata with type discriminator */
  metadata?: ContextMetadata;
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
