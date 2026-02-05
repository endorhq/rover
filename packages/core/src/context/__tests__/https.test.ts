import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { HTTPSProvider } from '../providers/https.js';
import { ContextFetchError } from '../errors.js';
import type { HTTPSResourceMetadata } from '../types.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/**
 * Create a mock Response object.
 */
function createMockResponse(options: {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  ok?: boolean;
}): Response {
  const status = options.status ?? 200;
  const ok = options.ok ?? (status >= 200 && status < 300);
  const body = options.body ?? '';
  const bodyBuffer =
    typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;

  // Create a readable stream from the body
  let position = 0;
  const reader = {
    read: vi.fn().mockImplementation(async () => {
      if (position >= bodyBuffer.length) {
        return { done: true, value: undefined };
      }
      const chunk = bodyBuffer.slice(position);
      position = bodyBuffer.length;
      return { done: false, value: new Uint8Array(chunk) };
    }),
    cancel: vi.fn(),
    releaseLock: vi.fn(),
  };

  const headers = new Headers(options.headers || {});
  if (!headers.has('content-type')) {
    headers.set('content-type', 'text/plain');
  }

  return {
    status,
    statusText: options.statusText ?? 'OK',
    ok,
    headers,
    body: {
      getReader: () => reader,
    },
  } as unknown as Response;
}

describe('HTTPSProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  describe('URI Parsing', () => {
    it('should handle standard HTTPS URL', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Hello World',
          headers: { 'content-type': 'text/plain' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/docs.md'),
        { originalUri: 'https://example.com/docs.md' }
      );

      expect(provider.uri).toBe('https://example.com/docs.md');
      expect(provider.scheme).toBe('https');

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/docs.md',
        expect.objectContaining({ redirect: 'manual' })
      );
    });

    it('should handle HTTPS shorthand without //', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Hello World',
          headers: { 'content-type': 'text/plain' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/docs.md'), // URL constructor normalizes
        { originalUri: 'https:example.com/docs.md' }
      );

      expect(provider.uri).toBe('https:example.com/docs.md');

      await provider.build();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/docs.md',
        expect.any(Object)
      );
    });

    it('should upgrade HTTP to HTTPS', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Hello World',
          headers: { 'content-type': 'text/plain' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('http://example.com/readme.txt'),
        { originalUri: 'http://example.com/readme.txt' }
      );

      await provider.build();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/readme.txt',
        expect.any(Object)
      );
    });

    it('should upgrade HTTP shorthand to HTTPS', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Hello World',
          headers: { 'content-type': 'text/plain' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('http://example.com/readme.txt'),
        { originalUri: 'http:example.com/readme.txt' }
      );

      await provider.build();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/readme.txt',
        expect.any(Object)
      );
    });

    it('should allow localhost URLs (no SSRF blocking)', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Local content',
          headers: { 'content-type': 'text/plain' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://localhost/file.txt'),
        { originalUri: 'https://localhost/file.txt' }
      );

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
    });

    it('should allow private IP URLs', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Private content',
          headers: { 'content-type': 'text/plain' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://192.168.1.1/config.txt'),
        { originalUri: 'https://192.168.1.1/config.txt' }
      );

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
    });
  });

  describe('MIME Type Validation', () => {
    it('should accept text/plain', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Plain text content',
          headers: { 'content-type': 'text/plain' },
        })
      );

      const provider = new HTTPSProvider(new URL('https://example.com/file'), {
        originalUri: 'https://example.com/file',
      });

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
    });

    it('should accept text/html', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: '<html><body>Hello</body></html>',
          headers: { 'content-type': 'text/html' },
        })
      );

      const provider = new HTTPSProvider(new URL('https://example.com/page'), {
        originalUri: 'https://example.com/page',
      });

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
    });

    it('should accept text/markdown', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: '# Hello\n\nWorld',
          headers: { 'content-type': 'text/markdown' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/readme.md'),
        { originalUri: 'https://example.com/readme.md' }
      );

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
    });

    it('should accept application/json', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: '{"key": "value"}',
          headers: { 'content-type': 'application/json' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/api/data'),
        { originalUri: 'https://example.com/api/data' }
      );

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
    });

    it('should accept application/xml', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: '<root><item>value</item></root>',
          headers: { 'content-type': 'application/xml' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/data.xml'),
        { originalUri: 'https://example.com/data.xml' }
      );

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
    });

    it('should accept text/x-python (any text/* allowed)', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'print("hello")',
          headers: { 'content-type': 'text/x-python' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/script.py'),
        { originalUri: 'https://example.com/script.py' }
      );

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
    });

    it('should accept application/yaml', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'key: value',
          headers: { 'content-type': 'application/yaml' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/config.yml'),
        { originalUri: 'https://example.com/config.yml' }
      );

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
    });

    it('should reject image/png', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'fake png data',
          headers: { 'content-type': 'image/png' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/image.png'),
        { originalUri: 'https://example.com/image.png' }
      );

      await expect(provider.build()).rejects.toThrow(
        /Unsupported content type/
      );
    });

    it('should reject application/pdf', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'fake pdf data',
          headers: { 'content-type': 'application/pdf' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/doc.pdf'),
        { originalUri: 'https://example.com/doc.pdf' }
      );

      await expect(provider.build()).rejects.toThrow(
        /Unsupported content type/
      );
    });

    it('should reject application/octet-stream', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'binary data',
          headers: { 'content-type': 'application/octet-stream' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/file.bin'),
        { originalUri: 'https://example.com/file.bin' }
      );

      await expect(provider.build()).rejects.toThrow(
        /Unsupported content type/
      );
    });

    it('should handle content-type with charset', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Hello World',
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
      );

      const provider = new HTTPSProvider(new URL('https://example.com/file'), {
        originalUri: 'https://example.com/file',
      });

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
    });
  });

  describe('Binary Detection', () => {
    it('should reject content with null bytes', async () => {
      // Create content with a null byte
      const binaryContent = Buffer.from([
        0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64,
      ]);

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: binaryContent,
          headers: { 'content-type': 'text/plain' },
        })
      );

      const provider = new HTTPSProvider(new URL('https://example.com/file'), {
        originalUri: 'https://example.com/file',
      });

      await expect(provider.build()).rejects.toThrow(/Binary content detected/);
    });

    it('should accept text without null bytes', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Hello World\nThis is text content.',
          headers: { 'content-type': 'text/plain' },
        })
      );

      const provider = new HTTPSProvider(new URL('https://example.com/file'), {
        originalUri: 'https://example.com/file',
      });

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
    });
  });

  describe('Content vs Filepath', () => {
    it('should use content field for inline content', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Inline content here',
          headers: { 'content-type': 'text/plain' },
        })
      );

      const provider = new HTTPSProvider(new URL('https://example.com/file'), {
        originalUri: 'https://example.com/file',
      });

      const entries = await provider.build();
      expect(entries[0].content).toBeDefined();
      expect(entries[0].filepath).toBeUndefined();
    });

    it('should use filepath for Content-Disposition: attachment', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Downloaded content',
          headers: {
            'content-type': 'text/plain',
            'content-disposition': 'attachment; filename="download.txt"',
          },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/download'),
        { originalUri: 'https://example.com/download' }
      );

      const entries = await provider.build();
      expect(entries[0].filepath).toBeDefined();
      expect(entries[0].content).toBeUndefined();

      // Verify file was written
      const fileContent = await fs.readFile(entries[0].filepath!, 'utf-8');
      expect(fileContent).toBe('Downloaded content');

      // Cleanup
      await fs.rm(path.dirname(entries[0].filepath!), {
        recursive: true,
        force: true,
      });
    });

    it('should use content field for Content-Disposition: inline', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Inline content',
          headers: {
            'content-type': 'text/plain',
            'content-disposition': 'inline',
          },
        })
      );

      const provider = new HTTPSProvider(new URL('https://example.com/file'), {
        originalUri: 'https://example.com/file',
      });

      const entries = await provider.build();
      expect(entries[0].content).toBeDefined();
      expect(entries[0].filepath).toBeUndefined();
    });
  });

  describe('Content Wrapping (Prompt Injection Guardrails)', () => {
    it('should wrap content in code blocks', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Some content',
          headers: { 'content-type': 'text/plain' },
        })
      );

      const provider = new HTTPSProvider(new URL('https://example.com/file'), {
        originalUri: 'https://example.com/file',
      });

      const entries = await provider.build();
      expect(entries[0].content).toContain('```');
      expect(entries[0].content).toContain('Some content');
    });

    it('should sanitize backticks in content', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Content with ```code``` blocks',
          headers: { 'content-type': 'text/plain' },
        })
      );

      const provider = new HTTPSProvider(new URL('https://example.com/file'), {
        originalUri: 'https://example.com/file',
      });

      const entries = await provider.build();
      // Backticks should be replaced with Unicode lookalike
      expect(entries[0].content).not.toContain('```code```');
      expect(entries[0].content).toContain(
        '\u02CB\u02CB\u02CBcode\u02CB\u02CB\u02CB'
      );
    });

    it('should include guardrail message', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Content',
          headers: { 'content-type': 'text/plain' },
        })
      );

      const provider = new HTTPSProvider(new URL('https://example.com/file'), {
        originalUri: 'https://example.com/file',
      });

      const entries = await provider.build();
      expect(entries[0].content).toContain('data only');
      expect(entries[0].content).toContain('do not interpret');
    });

    it('should use correct language hint for JSON', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: '{"key": "value"}',
          headers: { 'content-type': 'application/json' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/data.json'),
        { originalUri: 'https://example.com/data.json' }
      );

      const entries = await provider.build();
      expect(entries[0].content).toContain('```json');
    });
  });

  describe('Error Handling', () => {
    it('should throw ContextFetchError for 404', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 404,
          statusText: 'Not Found',
          ok: false,
          body: 'Not found',
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/missing'),
        { originalUri: 'https://example.com/missing' }
      );

      await expect(provider.build()).rejects.toThrow(/HTTP 404/);
    });

    it('should throw ContextFetchError for 500', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 500,
          statusText: 'Internal Server Error',
          ok: false,
          body: 'Server error',
        })
      );

      const provider = new HTTPSProvider(new URL('https://example.com/error'), {
        originalUri: 'https://example.com/error',
      });

      await expect(provider.build()).rejects.toThrow(/HTTP 500/);
    });

    it('should throw ContextFetchError for network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));

      const provider = new HTTPSProvider(new URL('https://example.com/file'), {
        originalUri: 'https://example.com/file',
      });

      await expect(provider.build()).rejects.toThrow(/Network error/);
    });

    it('should throw ContextFetchError for timeout', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const provider = new HTTPSProvider(new URL('https://example.com/slow'), {
        originalUri: 'https://example.com/slow',
      });

      await expect(provider.build()).rejects.toThrow(/timed out/);
    });

    it('should throw ContextFetchError for too many redirects', async () => {
      // Create 6 redirects (max is 5)
      for (let i = 0; i < 6; i++) {
        mockFetch.mockResolvedValueOnce(
          createMockResponse({
            status: 302,
            headers: { location: `https://example.com/redirect${i + 1}` },
          })
        );
      }

      const provider = new HTTPSProvider(
        new URL('https://example.com/redirect0'),
        { originalUri: 'https://example.com/redirect0' }
      );

      await expect(provider.build()).rejects.toThrow(/Too many redirects/);
    });
  });

  describe('Redirect Handling', () => {
    it('should follow redirects up to max limit', async () => {
      // First redirect
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 302,
          headers: { location: 'https://example.com/redirect1' },
        })
      );
      // Final response
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Final content',
          headers: { 'content-type': 'text/plain' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/original'),
        { originalUri: 'https://example.com/original' }
      );

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should track final URL in metadata', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 301,
          headers: { location: 'https://example.com/final' },
        })
      );
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Content',
          headers: { 'content-type': 'text/plain' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/original'),
        { originalUri: 'https://example.com/original' }
      );

      const entries = await provider.build();
      const metadata = entries[0].metadata as HTTPSResourceMetadata;
      expect(metadata.finalUrl).toBe('https://example.com/final');
    });

    it('should handle relative redirect URLs', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 302,
          headers: { location: '/new-path' },
        })
      );
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Content',
          headers: { 'content-type': 'text/plain' },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/original'),
        { originalUri: 'https://example.com/original' }
      );

      const entries = await provider.build();
      expect(entries).toHaveLength(1);
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://example.com/new-path',
        expect.any(Object)
      );
    });
  });

  describe('Metadata', () => {
    it('should include correct metadata', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Content',
          headers: {
            'content-type': 'application/json',
            'content-length': '7',
          },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/api/data.json'),
        { originalUri: 'https://example.com/api/data.json' }
      );

      const entries = await provider.build();
      const metadata = entries[0].metadata as HTTPSResourceMetadata;

      expect(metadata.type).toBe('https:resource');
      expect(metadata.finalUrl).toBe('https://example.com/api/data.json');
      expect(metadata.contentType).toBe('application/json');
      expect(metadata.isDownloaded).toBe(false);
      expect(metadata.extension).toBe('.json');
      expect(metadata.statusCode).toBe(200);
      expect(metadata.contentLength).toBe(7);
    });

    it('should set isDownloaded to true for attachments', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          body: 'Content',
          headers: {
            'content-type': 'text/plain',
            'content-disposition': 'attachment; filename="file.txt"',
          },
        })
      );

      const provider = new HTTPSProvider(
        new URL('https://example.com/download'),
        { originalUri: 'https://example.com/download' }
      );

      const entries = await provider.build();
      const metadata = entries[0].metadata as HTTPSResourceMetadata;
      expect(metadata.isDownloaded).toBe(true);

      // Cleanup
      if (entries[0].filepath) {
        await fs.rm(path.dirname(entries[0].filepath), {
          recursive: true,
          force: true,
        });
      }
    });
  });

  describe('Provider Properties', () => {
    it('should have correct scheme', () => {
      const provider = new HTTPSProvider(new URL('https://example.com/file'), {
        originalUri: 'https://example.com/file',
      });

      expect(provider.scheme).toBe('https');
    });

    it('should have correct supportedTypes', () => {
      const provider = new HTTPSProvider(new URL('https://example.com/file'), {
        originalUri: 'https://example.com/file',
      });

      expect(provider.supportedTypes).toEqual(['resource']);
    });

    it('should preserve original URI', () => {
      const provider = new HTTPSProvider(new URL('https://example.com/file'), {
        originalUri: 'http:example.com/file',
      });

      expect(provider.uri).toBe('http:example.com/file');
    });
  });
});
