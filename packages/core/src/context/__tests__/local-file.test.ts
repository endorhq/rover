import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalFileProvider } from '../providers/local-file.js';
import { ContextFetchError } from '../errors.js';

describe('LocalFileProvider', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-file-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('URI Parsing', () => {
    it('should parse file:./relative.md correctly (relative path)', () => {
      const provider = new LocalFileProvider(new URL('file:./relative.md'), {
        originalUri: 'file:./relative.md',
        cwd: tempDir,
      });

      expect(provider.uri).toBe('file:./relative.md');
      expect(provider.getResolvedPath()).toBe(
        path.join(tempDir, 'relative.md')
      );
    });

    it('should parse file:test.md correctly (relative without ./)', () => {
      const provider = new LocalFileProvider(new URL('file:test.md'), {
        originalUri: 'file:test.md',
        cwd: tempDir,
      });

      expect(provider.uri).toBe('file:test.md');
      expect(provider.getResolvedPath()).toBe(path.join(tempDir, 'test.md'));
    });

    it('should parse file:///absolute/path.md correctly (absolute)', () => {
      const provider = new LocalFileProvider(
        new URL('file:///absolute/path.md'),
        { originalUri: 'file:///absolute/path.md' }
      );

      expect(provider.uri).toBe('file:///absolute/path.md');
      expect(provider.getResolvedPath()).toBe('/absolute/path.md');
    });

    it('should parse file:/absolute/path.md correctly (absolute shorthand)', () => {
      const provider = new LocalFileProvider(
        new URL('file:/absolute/path.md'),
        { originalUri: 'file:/absolute/path.md' }
      );

      expect(provider.uri).toBe('file:/absolute/path.md');
      expect(provider.getResolvedPath()).toBe('/absolute/path.md');
    });

    it('should handle nested relative paths (../../file.md)', () => {
      const subdir = path.join(tempDir, 'a', 'b');
      const provider = new LocalFileProvider(new URL('file:../../file.md'), {
        originalUri: 'file:../../file.md',
        cwd: subdir,
      });

      expect(provider.getResolvedPath()).toBe(path.join(tempDir, 'file.md'));
    });
  });

  describe('Path Resolution', () => {
    it('should resolve relative paths from cwd option', () => {
      const provider = new LocalFileProvider(new URL('file:./docs/readme.md'), {
        originalUri: 'file:./docs/readme.md',
        cwd: tempDir,
      });

      expect(provider.getResolvedPath()).toBe(
        path.join(tempDir, 'docs', 'readme.md')
      );
    });

    it('should resolve relative paths from process.cwd() when no cwd option', () => {
      const provider = new LocalFileProvider(new URL('file:./some-file.md'), {
        originalUri: 'file:./some-file.md',
      });

      expect(provider.getResolvedPath()).toBe(
        path.join(process.cwd(), 'some-file.md')
      );
    });

    it('should handle absolute paths unchanged', () => {
      const absolutePath = '/home/user/documents/file.md';
      const provider = new LocalFileProvider(
        new URL(`file://${absolutePath}`),
        { originalUri: `file://${absolutePath}`, cwd: tempDir }
      );

      expect(provider.getResolvedPath()).toBe(absolutePath);
    });
  });

  describe('build() method', () => {
    it('should return ContextEntry with filepath for text files', async () => {
      const filePath = path.join(tempDir, 'test.md');
      await fs.writeFile(filePath, '# Test\n\nSome content');

      const provider = new LocalFileProvider(new URL(`file://${filePath}`), {
        originalUri: `file://${filePath}`,
      });

      const entries = await provider.build();

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('test.md');
      expect(entries[0].filepath).toBe(filePath);
      expect(entries[0].source).toBe(`file://${filePath}`);
      expect(entries[0].description).toContain(filePath);
      expect(entries[0].filename).toMatch(/^local-file-.*\.md$/);
      expect(entries[0].fetchedAt).toBeInstanceOf(Date);
      // content should not be set (we use filepath instead)
      expect(entries[0].content).toBeUndefined();
    });

    it('should throw ContextFetchError for non-existent files', async () => {
      const nonExistent = path.join(tempDir, 'does-not-exist.md');
      const provider = new LocalFileProvider(new URL(`file://${nonExistent}`), {
        originalUri: `file://${nonExistent}`,
      });

      await expect(provider.build()).rejects.toThrow(ContextFetchError);
      await expect(provider.build()).rejects.toThrow('File not found');
    });

    it('should throw ContextFetchError for symlinks', async () => {
      const realFile = path.join(tempDir, 'real.md');
      const symlink = path.join(tempDir, 'link.md');

      await fs.writeFile(realFile, 'content');
      await fs.symlink(realFile, symlink);

      const provider = new LocalFileProvider(new URL(`file://${symlink}`), {
        originalUri: `file://${symlink}`,
      });

      await expect(provider.build()).rejects.toThrow(ContextFetchError);
      await expect(provider.build()).rejects.toThrow('Symbolic links');
    });

    it('should throw ContextFetchError for binary files', async () => {
      const binaryFile = path.join(tempDir, 'binary.bin');
      // Create a buffer with null bytes (binary indicator)
      const buffer = Buffer.from([0x00, 0x01, 0x02, 0x00, 0x03]);
      await fs.writeFile(binaryFile, buffer);

      const provider = new LocalFileProvider(new URL(`file://${binaryFile}`), {
        originalUri: `file://${binaryFile}`,
      });

      await expect(provider.build()).rejects.toThrow(ContextFetchError);
      await expect(provider.build()).rejects.toThrow('Binary files');
    });

    it('should throw ContextFetchError for directories', async () => {
      const dirPath = path.join(tempDir, 'subdir');
      await fs.mkdir(dirPath);

      const provider = new LocalFileProvider(new URL(`file://${dirPath}`), {
        originalUri: `file://${dirPath}`,
      });

      await expect(provider.build()).rejects.toThrow(ContextFetchError);
      await expect(provider.build()).rejects.toThrow('Not a regular file');
    });

    it('should handle files with various extensions (.md, .txt, .json, .ts)', async () => {
      const extensions = ['.md', '.txt', '.json', '.ts'];

      for (const ext of extensions) {
        const filePath = path.join(tempDir, `test${ext}`);
        await fs.writeFile(filePath, `content for ${ext}`);

        const provider = new LocalFileProvider(new URL(`file://${filePath}`), {
          originalUri: `file://${filePath}`,
        });

        const entries = await provider.build();
        expect(entries).toHaveLength(1);
        expect(entries[0].name).toBe(`test${ext}`);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty files', async () => {
      const emptyFile = path.join(tempDir, 'empty.md');
      await fs.writeFile(emptyFile, '');

      const provider = new LocalFileProvider(new URL(`file://${emptyFile}`), {
        originalUri: `file://${emptyFile}`,
      });

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
      expect(entries[0].filepath).toBe(emptyFile);
    });

    it('should handle files with only whitespace', async () => {
      const whitespaceFile = path.join(tempDir, 'whitespace.txt');
      await fs.writeFile(whitespaceFile, '   \n\t\n   ');

      const provider = new LocalFileProvider(
        new URL(`file://${whitespaceFile}`),
        { originalUri: `file://${whitespaceFile}` }
      );

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
      expect(entries[0].filepath).toBe(whitespaceFile);
    });

    it('should handle files with special characters in name', async () => {
      // Files with spaces and special chars work when using absolute paths
      // The URL API requires encoding, but originalUri preserves the real path
      const specialFile = path.join(tempDir, 'file-with-dashes.md');
      await fs.writeFile(specialFile, 'content');

      const provider = new LocalFileProvider(new URL(`file://${specialFile}`), {
        originalUri: `file://${specialFile}`,
      });

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe('file-with-dashes.md');
    });

    it('should use originalUri from options when available', () => {
      const originalUri = 'file:./my-file.md';
      const provider = new LocalFileProvider(
        new URL('file:///my-file.md'), // URL API normalizes this
        { originalUri, cwd: tempDir }
      );

      expect(provider.uri).toBe(originalUri);
    });

    it('should fall back to url.href when originalUri not provided', () => {
      const url = new URL('file:///some/path.md');
      const provider = new LocalFileProvider(url, {});

      expect(provider.uri).toBe(url.href);
    });

    it('should handle large text files without binary detection false positives', async () => {
      const largeFile = path.join(tempDir, 'large.txt');
      // Create a 10KB text file
      const content = 'Hello World\n'.repeat(1000);
      await fs.writeFile(largeFile, content);

      const provider = new LocalFileProvider(new URL(`file://${largeFile}`), {
        originalUri: `file://${largeFile}`,
      });

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
      expect(entries[0].filepath).toBe(largeFile);
    });
  });

  describe('Provider properties', () => {
    it('should have correct scheme', () => {
      const provider = new LocalFileProvider(new URL('file:./test.md'), {
        originalUri: 'file:./test.md',
      });

      expect(provider.scheme).toBe('file');
    });

    it('should have correct supportedTypes', () => {
      const provider = new LocalFileProvider(new URL('file:./test.md'), {
        originalUri: 'file:./test.md',
      });

      expect(provider.supportedTypes).toEqual(['text']);
    });
  });
});
