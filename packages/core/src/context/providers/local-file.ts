import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ContextEntry,
  ContextProvider,
  ProviderOptions,
} from '../types.js';
import { ContextFetchError } from '../errors.js';

/**
 * Check if a buffer likely contains binary content.
 * Uses null-byte detection in the first 8KB.
 */
function isBinaryContent(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Extract path from a file: URI string.
 * Handles various formats:
 * - file:./relative.md → ./relative.md
 * - file:test.md → test.md
 * - file:///absolute/path.md → /absolute/path.md
 * - file:/absolute/path.md → /absolute/path.md
 */
function extractPathFromFileUri(uri: string): string {
  // Remove the "file:" prefix
  const afterScheme = uri.slice(5);

  // Handle triple-slash absolute paths: file:///path → /path
  if (afterScheme.startsWith('///')) {
    return afterScheme.slice(2);
  }

  // Handle single-slash absolute paths: file:/path → /path
  if (afterScheme.startsWith('/') && !afterScheme.startsWith('//')) {
    return afterScheme;
  }

  // Handle Windows absolute paths with drive letter: file:///C:/... → C:/...
  // After removing ///, if it looks like C:/ or c:/, it's a Windows path
  if (afterScheme.startsWith('///')) {
    const pathPart = afterScheme.slice(3);
    if (/^[a-zA-Z]:/.test(pathPart)) {
      return pathPart;
    }
  }

  // Relative paths: file:./relative.md or file:test.md
  return afterScheme;
}

/**
 * Generate a safe filename from a path.
 * Replaces path separators and special characters.
 */
function generateFilename(filePath: string): string {
  const basename = path.basename(filePath);
  // Replace special characters with dashes, keep alphanumeric, dots, and dashes
  const safe = basename.replace(/[^a-zA-Z0-9.-]/g, '-').toLowerCase();
  return `local-file-${safe}`;
}

/**
 * Context provider for local file references.
 * Supports URI formats:
 * - file:./relative.md (relative path)
 * - file:test.md (relative without ./)
 * - file:///home/user/doc.md (absolute canonical)
 * - file:/home/user/doc.md (absolute shorthand)
 */
export class LocalFileProvider implements ContextProvider {
  readonly scheme = 'file';
  readonly supportedTypes = ['text'];
  readonly uri: string;

  private readonly resolvedPath: string;
  private readonly cwd: string;

  constructor(url: URL, options: ProviderOptions = {}) {
    this.uri = options.originalUri ?? url.href;
    this.cwd = options.cwd ?? process.cwd();

    // Extract path from original URI (not normalized URL)
    const filePath = extractPathFromFileUri(this.uri);

    // Resolve relative paths from cwd
    this.resolvedPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.cwd, filePath);
  }

  /**
   * Get the resolved absolute path.
   * Useful for testing and debugging.
   */
  getResolvedPath(): string {
    return this.resolvedPath;
  }

  async build(): Promise<ContextEntry[]> {
    // 1. Check file exists
    let stats: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stats = await fs.lstat(this.resolvedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ContextFetchError(
          this.uri,
          `File not found: ${this.resolvedPath}`
        );
      }
      if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        throw new ContextFetchError(
          this.uri,
          `Permission denied: ${this.resolvedPath}`
        );
      }
      throw new ContextFetchError(
        this.uri,
        `Failed to access file: ${(error as Error).message}`
      );
    }

    // 2. Check for symlinks
    if (stats.isSymbolicLink()) {
      throw new ContextFetchError(
        this.uri,
        `Symbolic links are not supported: ${this.resolvedPath}`
      );
    }

    // 3. Check it's a regular file
    if (!stats.isFile()) {
      throw new ContextFetchError(
        this.uri,
        `Not a regular file: ${this.resolvedPath}`
      );
    }

    // 4. Read file content to check for binary
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(this.resolvedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        throw new ContextFetchError(
          this.uri,
          `Permission denied reading file: ${this.resolvedPath}`
        );
      }
      throw new ContextFetchError(
        this.uri,
        `Failed to read file: ${(error as Error).message}`
      );
    }

    // 5. Check for binary content
    if (isBinaryContent(buffer)) {
      throw new ContextFetchError(
        this.uri,
        `Binary files are not supported: ${this.resolvedPath}`
      );
    }

    // 6. Return ContextEntry with filepath (not content)
    const basename = path.basename(this.resolvedPath);
    const entry: ContextEntry = {
      name: basename,
      description: `Local file: ${this.resolvedPath}`,
      filename: generateFilename(this.resolvedPath),
      filepath: this.resolvedPath,
      source: this.uri,
      fetchedAt: new Date(),
    };

    return [entry];
  }
}
