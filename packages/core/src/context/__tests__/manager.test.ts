import * as fs from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IterationContextEntry } from 'rover-schemas';
import { ContextManager } from '../manager.js';
import { registerContextProvider, clearContextProviders } from '../registry.js';
import { ContextFetchError } from '../errors.js';
import type {
  ContextEntry,
  ContextProvider,
  ProviderOptions,
} from '../types.js';
import type { TaskDescriptionManager } from '../../files/task-description.js';
import type { IterationManager } from '../../files/iteration.js';

// Mock provider that returns configurable entries
class MockProvider implements ContextProvider {
  readonly scheme = 'mock';
  readonly supportedTypes = ['test'];
  readonly uri: string;
  private entries: ContextEntry[];
  private shouldFail: boolean;
  private failMessage: string;

  constructor(url: URL, options?: ProviderOptions) {
    this.uri = options?.originalUri ?? url.href;
    // Extract configuration from URL search params for testing
    const params = url.searchParams;
    this.shouldFail = params.get('fail') === 'true';
    this.failMessage = params.get('failMessage') ?? 'Mock failure';

    // Default entries based on URL
    const name = params.get('name') ?? 'Mock Entry';
    const description = params.get('description') ?? 'A mock context entry';
    const filename = params.get('filename') ?? 'mock-entry.md';
    const content = params.get('content') ?? '# Mock Content';

    this.entries = [
      {
        name,
        description,
        filename,
        content,
        source: this.uri,
        fetchedAt: new Date(),
        metadata: { type: 'mock:test' },
      },
    ];
  }

  async build(): Promise<ContextEntry[]> {
    if (this.shouldFail) {
      throw new ContextFetchError(this.uri, this.failMessage);
    }
    return this.entries;
  }
}

/**
 * Create a mock TaskDescriptionManager for testing.
 */
function createMockTask(options: {
  basePath: string;
  iterations: number;
  lastIterationContext?: IterationContextEntry[];
}): TaskDescriptionManager {
  const iterationsPath = path.join(options.basePath, 'iterations');

  return {
    getIterationPath: () =>
      path.join(iterationsPath, options.iterations.toString()),
    iterations: options.iterations,
    iterationsPath: () => iterationsPath,
    getLastIteration: () => {
      if (!options.lastIterationContext) {
        return undefined;
      }
      return {
        context: options.lastIterationContext,
      } as IterationManager;
    },
  } as TaskDescriptionManager;
}

describe('ContextManager', () => {
  let tempDir: string;

  beforeEach(async () => {
    clearContextProviders();
    registerContextProvider('mock', MockProvider);
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-manager-test-'));
  });

  afterEach(async () => {
    clearContextProviders();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should create a ContextManager with URIs and task', () => {
      const task = createMockTask({ basePath: tempDir, iterations: 1 });
      const manager = new ContextManager(['mock://test'], task);

      expect(manager.getContextDir()).toBe(
        path.join(tempDir, 'iterations', '1', 'context')
      );
    });

    it('should create a ContextManager with empty URIs', () => {
      const task = createMockTask({ basePath: tempDir, iterations: 1 });
      const manager = new ContextManager([], task);

      expect(manager.getContextDir()).toBe(
        path.join(tempDir, 'iterations', '1', 'context')
      );
    });
  });

  describe('fetchAndStore', () => {
    it('should create context directory even with no URIs', async () => {
      const task = createMockTask({ basePath: tempDir, iterations: 1 });
      const manager = new ContextManager([], task);

      const entries = await manager.fetchAndStore();

      expect(entries).toEqual([]);
      expect(existsSync(manager.getContextDir())).toBe(true);
    });

    it('should fetch and store a single context entry', async () => {
      const task = createMockTask({ basePath: tempDir, iterations: 1 });
      mkdirSync(task.getIterationPath(), { recursive: true });

      const manager = new ContextManager(
        ['mock://test?name=Test%20Entry&filename=test.md'],
        task
      );

      const entries = await manager.fetchAndStore();

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('Test Entry');
      expect(entries[0].file).toBe('test.md');
      expect(entries[0].provenance.addedIn).toBe(1);
      expect(entries[0].provenance.updatedIn).toBeUndefined();

      // File should be written
      const filePath = path.join(manager.getContextDir(), 'test.md');
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, 'utf8')).toBe('# Mock Content');
    });

    it('should fetch multiple context entries', async () => {
      const task = createMockTask({ basePath: tempDir, iterations: 1 });
      mkdirSync(task.getIterationPath(), { recursive: true });

      const manager = new ContextManager(
        [
          'mock://test1?name=First&filename=first.md',
          'mock://test2?name=Second&filename=second.md',
        ],
        task
      );

      const entries = await manager.fetchAndStore();

      expect(entries).toHaveLength(2);
      expect(entries[0].name).toBe('First');
      expect(entries[1].name).toBe('Second');
    });

    it('should fail if any provider fails', async () => {
      const task = createMockTask({ basePath: tempDir, iterations: 1 });
      mkdirSync(task.getIterationPath(), { recursive: true });

      const manager = new ContextManager(
        [
          'mock://test1?name=First&filename=first.md',
          'mock://test2?fail=true&failMessage=Network%20error',
        ],
        task
      );

      await expect(manager.fetchAndStore()).rejects.toThrow(ContextFetchError);
      await expect(manager.fetchAndStore()).rejects.toThrow('Network error');
    });

    it('should pass trust settings to providers', async () => {
      const task = createMockTask({ basePath: tempDir, iterations: 1 });
      mkdirSync(task.getIterationPath(), { recursive: true });

      const manager = new ContextManager(
        ['mock://test?name=Test&filename=test.md'],
        task,
        {
          trustAllAuthors: true,
          trustedAuthors: ['alice', 'bob'],
        }
      );

      const entries = await manager.fetchAndStore();

      expect(entries).toHaveLength(1);
      expect(entries[0].trustSettings).toEqual({
        trustAllAuthors: true,
        trustedAuthors: ['alice', 'bob'],
      });
    });

    it('should not include trust settings if not provided', async () => {
      const task = createMockTask({ basePath: tempDir, iterations: 1 });
      mkdirSync(task.getIterationPath(), { recursive: true });

      const manager = new ContextManager(
        ['mock://test?name=Test&filename=test.md'],
        task
      );

      const entries = await manager.fetchAndStore();

      expect(entries).toHaveLength(1);
      expect(entries[0].trustSettings).toBeUndefined();
    });
  });

  describe('inheritance from previous iteration', () => {
    it('should inherit entries from previous iteration', async () => {
      // Set up previous iteration files
      const prevContextDir = path.join(tempDir, 'iterations', '1', 'context');
      mkdirSync(prevContextDir, { recursive: true });
      writeFileSync(path.join(prevContextDir, 'prev.md'), '# Previous Content');

      const previousContext: IterationContextEntry[] = [
        {
          uri: 'mock://previous',
          fetchedAt: '2024-01-01T00:00:00Z',
          file: 'prev.md',
          name: 'Previous Entry',
          description: 'From previous iteration',
          provenance: { addedIn: 1 },
        },
      ];

      // Current iteration (2) with previous context
      const task = createMockTask({
        basePath: tempDir,
        iterations: 2,
        lastIterationContext: previousContext,
      });
      mkdirSync(task.getIterationPath(), { recursive: true });

      const manager = new ContextManager([], task);

      const entries = await manager.fetchAndStore();

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('Previous Entry');
      expect(entries[0].provenance.addedIn).toBe(1);
      expect(entries[0].provenance.updatedIn).toBeUndefined();

      // File should be copied
      const filePath = path.join(manager.getContextDir(), 'prev.md');
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, 'utf8')).toBe('# Previous Content');
    });

    it('should re-fetch entries when URI is in new URIs list', async () => {
      // Set up previous iteration files
      const prevContextDir = path.join(tempDir, 'iterations', '1', 'context');
      mkdirSync(prevContextDir, { recursive: true });
      writeFileSync(path.join(prevContextDir, 'refetch.md'), '# Old Content');

      const sharedUri =
        'mock://shared?name=Shared&filename=refetch.md&content=%23%20New%20Content';
      const previousContext: IterationContextEntry[] = [
        {
          uri: sharedUri,
          fetchedAt: '2024-01-01T00:00:00Z',
          file: 'refetch.md',
          name: 'Shared Entry',
          description: 'Will be re-fetched',
          provenance: { addedIn: 1 },
        },
      ];

      // Current iteration with same URI
      const task = createMockTask({
        basePath: tempDir,
        iterations: 2,
        lastIterationContext: previousContext,
      });
      mkdirSync(task.getIterationPath(), { recursive: true });

      const manager = new ContextManager([sharedUri], task);

      const entries = await manager.fetchAndStore();

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('Shared');
      // Should have updatedIn since it was re-fetched
      expect(entries[0].provenance.addedIn).toBe(1);
      expect(entries[0].provenance.updatedIn).toBe(2);
    });

    it('should combine inherited and new entries', async () => {
      // Set up previous iteration files
      const prevContextDir = path.join(tempDir, 'iterations', '1', 'context');
      mkdirSync(prevContextDir, { recursive: true });
      writeFileSync(path.join(prevContextDir, 'inherited.md'), '# Inherited');

      const previousContext: IterationContextEntry[] = [
        {
          uri: 'mock://inherited',
          fetchedAt: '2024-01-01T00:00:00Z',
          file: 'inherited.md',
          name: 'Inherited Entry',
          description: 'From previous',
          provenance: { addedIn: 1 },
        },
      ];

      // Current iteration with new URI
      const task = createMockTask({
        basePath: tempDir,
        iterations: 2,
        lastIterationContext: previousContext,
      });
      mkdirSync(task.getIterationPath(), { recursive: true });

      const manager = new ContextManager(
        ['mock://new?name=New%20Entry&filename=new.md'],
        task
      );

      const entries = await manager.fetchAndStore();

      expect(entries).toHaveLength(2);

      const inherited = entries.find(e => e.name === 'Inherited Entry');
      const newEntry = entries.find(e => e.name === 'New Entry');

      expect(inherited).toBeDefined();
      expect(inherited!.provenance.addedIn).toBe(1);
      expect(inherited!.provenance.updatedIn).toBeUndefined();

      expect(newEntry).toBeDefined();
      expect(newEntry!.provenance.addedIn).toBe(2);
      expect(newEntry!.provenance.updatedIn).toBeUndefined();
    });

    it('should handle missing previous context file gracefully', async () => {
      // Set up previous iteration but don't create the file
      const prevContextDir = path.join(tempDir, 'iterations', '1', 'context');
      mkdirSync(prevContextDir, { recursive: true });
      // Don't write the file

      const previousContext: IterationContextEntry[] = [
        {
          uri: 'mock://missing-file',
          fetchedAt: '2024-01-01T00:00:00Z',
          file: 'missing.md',
          name: 'Missing Entry',
          description: 'File was deleted',
          provenance: { addedIn: 1 },
        },
      ];

      const task = createMockTask({
        basePath: tempDir,
        iterations: 2,
        lastIterationContext: previousContext,
      });
      mkdirSync(task.getIterationPath(), { recursive: true });

      const manager = new ContextManager([], task);

      const entries = await manager.fetchAndStore();

      // Entry should still be inherited (metadata preserved)
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('Missing Entry');

      // But file won't exist in new context (copy failed silently)
      const filePath = path.join(manager.getContextDir(), 'missing.md');
      expect(existsSync(filePath)).toBe(false);
    });

    it('should not inherit when iteration is 1', async () => {
      // First iteration has no previous context to inherit
      const task = createMockTask({
        basePath: tempDir,
        iterations: 1,
        lastIterationContext: undefined,
      });
      mkdirSync(task.getIterationPath(), { recursive: true });

      const manager = new ContextManager(
        ['mock://test?name=First&filename=first.md'],
        task
      );

      const entries = await manager.fetchAndStore();

      expect(entries).toHaveLength(1);
      expect(entries[0].provenance.addedIn).toBe(1);
    });
  });

  describe('provenance tracking', () => {
    it('should set addedIn for new entries', async () => {
      const task = createMockTask({ basePath: tempDir, iterations: 3 });
      mkdirSync(task.getIterationPath(), { recursive: true });

      const manager = new ContextManager(
        ['mock://test?name=New&filename=new.md'],
        task
      );

      const entries = await manager.fetchAndStore();

      expect(entries[0].provenance).toEqual({ addedIn: 3 });
    });

    it('should preserve addedIn and set updatedIn for re-fetched entries', async () => {
      const prevContextDir = path.join(tempDir, 'iterations', '2', 'context');
      mkdirSync(prevContextDir, { recursive: true });

      const sharedUri = 'mock://shared?name=Shared&filename=shared.md';
      const previousContext: IterationContextEntry[] = [
        {
          uri: sharedUri,
          fetchedAt: '2024-01-01T00:00:00Z',
          file: 'shared.md',
          name: 'Shared',
          description: 'Original',
          provenance: { addedIn: 1 },
        },
      ];

      const task = createMockTask({
        basePath: tempDir,
        iterations: 3,
        lastIterationContext: previousContext,
      });
      mkdirSync(task.getIterationPath(), { recursive: true });

      const manager = new ContextManager([sharedUri], task);

      const entries = await manager.fetchAndStore();

      expect(entries[0].provenance).toEqual({
        addedIn: 1,
        updatedIn: 3,
      });
    });

    it('should preserve original provenance for inherited entries', async () => {
      const prevContextDir = path.join(tempDir, 'iterations', '4', 'context');
      mkdirSync(prevContextDir, { recursive: true });
      writeFileSync(path.join(prevContextDir, 'old.md'), '# Old');

      const previousContext: IterationContextEntry[] = [
        {
          uri: 'mock://old',
          fetchedAt: '2024-01-01T00:00:00Z',
          file: 'old.md',
          name: 'Old Entry',
          description: 'Very old',
          provenance: { addedIn: 1, updatedIn: 2 },
        },
      ];

      const task = createMockTask({
        basePath: tempDir,
        iterations: 5,
        lastIterationContext: previousContext,
      });
      mkdirSync(task.getIterationPath(), { recursive: true });

      const manager = new ContextManager([], task);

      const entries = await manager.fetchAndStore();

      // Inherited entries should have addedIn only (no updatedIn since not re-fetched)
      expect(entries[0].provenance).toEqual({ addedIn: 1 });
    });
  });

  describe('error handling', () => {
    it('should wrap non-ContextFetchError errors', async () => {
      // Register a provider that throws a generic error
      class ThrowingProvider implements ContextProvider {
        readonly scheme = 'throwing';
        readonly supportedTypes = ['test'];
        readonly uri: string;

        constructor(url: URL, options?: ProviderOptions) {
          this.uri = options?.originalUri ?? url.href;
        }

        async build(): Promise<ContextEntry[]> {
          throw new Error('Generic error');
        }
      }

      registerContextProvider('throwing', ThrowingProvider);

      const task = createMockTask({ basePath: tempDir, iterations: 1 });
      mkdirSync(task.getIterationPath(), { recursive: true });

      const manager = new ContextManager(['throwing://test'], task);

      await expect(manager.fetchAndStore()).rejects.toThrow(ContextFetchError);
      await expect(manager.fetchAndStore()).rejects.toThrow('Generic error');
    });

    it('should preserve ContextFetchError without wrapping', async () => {
      const task = createMockTask({ basePath: tempDir, iterations: 1 });
      mkdirSync(task.getIterationPath(), { recursive: true });

      const manager = new ContextManager(
        ['mock://test?fail=true&failMessage=Original%20error'],
        task
      );

      try {
        await manager.fetchAndStore();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ContextFetchError);
        expect((error as ContextFetchError).reason).toBe('Original error');
      }
    });
  });

  describe('metadata handling', () => {
    it('should include provider metadata in entries', async () => {
      const task = createMockTask({ basePath: tempDir, iterations: 1 });
      mkdirSync(task.getIterationPath(), { recursive: true });

      const manager = new ContextManager(
        ['mock://test?name=Test&filename=test.md'],
        task
      );

      const entries = await manager.fetchAndStore();

      expect(entries[0].metadata).toEqual({ type: 'mock:test' });
    });
  });
});
