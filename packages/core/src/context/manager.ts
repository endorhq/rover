/**
 * Context Manager - Orchestrates fetching, storage, and inheritance of context entries.
 *
 * The ContextManager handles:
 * 1. Fetching new context from URIs using registered providers
 * 2. Inheriting context from previous iterations
 * 3. Writing context files to the iteration's context folder
 * 4. Tracking provenance (when context was added/updated)
 */
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  IterationContextEntry,
  TrustSettings,
  Provenance,
} from 'rover-schemas';
import { createContextProvider } from './registry.js';
import { ContextFetchError } from './errors.js';
import type { ContextEntry, ProviderOptions } from './types.js';
import type { TaskDescriptionManager } from '../files/task-description.js';

/**
 * Options for the ContextManager.
 */
export interface ContextManagerOptions {
  /** Trust all authors for comment inclusion */
  trustAllAuthors?: boolean;
  /** Trust specific authors for comment inclusion */
  trustedAuthors?: string[];
  /** Current working directory for resolving relative paths */
  cwd?: string;
}

/**
 * Context Manager class that orchestrates fetching, storage, and inheritance of context.
 */
export class ContextManager {
  private uris: string[];
  private task: TaskDescriptionManager;
  private options: ContextManagerOptions;
  private contextDir: string;

  /**
   * Create a new ContextManager.
   *
   * @param uris - URIs to fetch context from (from CLI --context flags)
   * @param task - The task description manager instance
   * @param options - Trust settings and other options
   */
  constructor(
    uris: string[],
    task: TaskDescriptionManager,
    options?: ContextManagerOptions
  ) {
    this.uris = uris;
    this.task = task;
    this.options = options ?? {};
    this.contextDir = join(task.getIterationPath(), 'context');
  }

  /**
   * Main orchestration: fetch new context, inherit previous, write files, return entries.
   *
   * @returns Array of all context entries (inherited + new)
   * @throws ContextFetchError if any provider fails
   */
  async fetchAndStore(): Promise<IterationContextEntry[]> {
    // Always create context directory
    this.ensureContextDir();

    // Get new URIs as a Set for fast lookup
    const newUriSet = new Set(this.uris);

    // Inherit entries from previous iteration that are not being re-fetched
    const inheritedEntries = await this.inheritPreviousContext(newUriSet);

    // Fetch new context entries
    const newEntries = await this.fetchNewContext();

    // Combine inherited and new entries
    return [...inheritedEntries, ...newEntries];
  }

  /**
   * Get the path to the context directory.
   */
  getContextDir(): string {
    return this.contextDir;
  }

  /**
   * Ensure the context directory exists.
   */
  private ensureContextDir(): void {
    if (!existsSync(this.contextDir)) {
      mkdirSync(this.contextDir, { recursive: true });
    }
  }

  /**
   * Get context entries from the previous iteration.
   */
  private getPreviousContext(): IterationContextEntry[] {
    const lastIteration = this.task.getLastIteration();
    return lastIteration?.context ?? [];
  }

  /**
   * Get the path to the previous iteration directory.
   */
  private getPreviousIterationPath(): string | undefined {
    const currentIteration = this.task.iterations;
    if (currentIteration <= 1) {
      return undefined;
    }
    return join(this.task.iterationsPath(), (currentIteration - 1).toString());
  }

  /**
   * Inherit context entries from the previous iteration.
   * Only inherits entries whose URIs are not in the new URIs list.
   */
  private async inheritPreviousContext(
    newUriSet: Set<string>
  ): Promise<IterationContextEntry[]> {
    const previousContext = this.getPreviousContext();
    const previousIterationPath = this.getPreviousIterationPath();
    const inheritedEntries: IterationContextEntry[] = [];

    for (const prevEntry of previousContext) {
      // Skip if this URI will be re-fetched
      if (newUriSet.has(prevEntry.uri)) {
        continue;
      }

      // Copy the file from previous iteration
      if (previousIterationPath) {
        const sourcePath = join(
          previousIterationPath,
          'context',
          prevEntry.file
        );
        const destPath = join(this.contextDir, prevEntry.file);

        if (existsSync(sourcePath)) {
          copyFileSync(sourcePath, destPath);
        }
      }

      // Keep the entry with original provenance (no updatedIn)
      inheritedEntries.push({
        ...prevEntry,
        // Ensure provenance is preserved exactly
        provenance: {
          addedIn: prevEntry.provenance.addedIn,
          // Don't set updatedIn for inherited entries
        },
      });
    }

    return inheritedEntries;
  }

  /**
   * Fetch new context entries from the configured URIs.
   */
  private async fetchNewContext(): Promise<IterationContextEntry[]> {
    const entries: IterationContextEntry[] = [];
    const previousContext = this.getPreviousContext();

    // Build a map of previous entries by URI for re-fetch detection
    const previousByUri = new Map<string, IterationContextEntry>();
    for (const entry of previousContext) {
      previousByUri.set(entry.uri, entry);
    }

    for (const uri of this.uris) {
      // Build provider options from manager options
      const providerOptions: ProviderOptions = {
        trustAllAuthors: this.options.trustAllAuthors,
        trustAuthors: this.options.trustedAuthors,
        cwd: this.options.cwd,
      };

      // Create provider and fetch content
      const provider = createContextProvider(uri, providerOptions);
      let contextEntries: ContextEntry[];

      try {
        contextEntries = await provider.build();
      } catch (error) {
        // Re-throw as ContextFetchError if it isn't already
        if (error instanceof ContextFetchError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new ContextFetchError(uri, message);
      }

      // Process each entry from the provider
      for (const contextEntry of contextEntries) {
        // Write content to file
        const filePath = join(this.contextDir, contextEntry.filename);
        this.writeContextFile(filePath, contextEntry);

        // Determine provenance
        const previousEntry = previousByUri.get(uri);
        const provenance: Provenance = this.determineProvenance(previousEntry);

        // Build trust settings
        const trustSettings = this.buildTrustSettings();

        // Create iteration context entry
        const iterationEntry: IterationContextEntry = {
          uri: contextEntry.source,
          fetchedAt: contextEntry.fetchedAt.toISOString(),
          file: contextEntry.filename,
          name: contextEntry.name,
          description: contextEntry.description,
          provenance,
          ...(trustSettings && { trustSettings }),
          ...(contextEntry.metadata && {
            metadata:
              contextEntry.metadata as IterationContextEntry['metadata'],
          }),
        };

        entries.push(iterationEntry);
      }
    }

    return entries;
  }

  /**
   * Determine provenance for a new/updated entry.
   */
  private determineProvenance(
    previousEntry?: IterationContextEntry
  ): Provenance {
    const currentIteration = this.task.iterations;

    if (previousEntry) {
      // Re-fetched entry: keep original addedIn, set updatedIn
      return {
        addedIn: previousEntry.provenance.addedIn,
        updatedIn: currentIteration,
      };
    } else {
      // New entry: set addedIn to current iteration
      return {
        addedIn: currentIteration,
      };
    }
  }

  /**
   * Build trust settings from options.
   */
  private buildTrustSettings(): TrustSettings | undefined {
    if (
      this.options.trustAllAuthors === undefined &&
      !this.options.trustedAuthors?.length
    ) {
      return undefined;
    }

    return {
      ...(this.options.trustAllAuthors !== undefined && {
        trustAllAuthors: this.options.trustAllAuthors,
      }),
      ...(this.options.trustedAuthors?.length && {
        trustedAuthors: this.options.trustedAuthors,
      }),
    };
  }

  /**
   * Write context entry content to file.
   */
  private writeContextFile(filePath: string, entry: ContextEntry): void {
    if (entry.content) {
      writeFileSync(filePath, entry.content, 'utf8');
    } else if (entry.filepath) {
      // For local files, copy the file
      copyFileSync(entry.filepath, filePath);
    }
  }
}
