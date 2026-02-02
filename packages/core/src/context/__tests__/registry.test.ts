import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ContextProvider,
  ProviderOptions,
  ContextEntry,
} from '../types.js';
import {
  registerContextProvider,
  createContextProvider,
  isContextSchemeSupported,
  getRegisteredSchemes,
  clearContextProviders,
} from '../registry.js';
import {
  ContextSchemeNotSupportedError,
  ContextUriParseError,
} from '../errors.js';

// Test provider implementation
class TestProvider implements ContextProvider {
  readonly scheme = 'test';
  readonly supportedTypes = ['type1', 'type2'];
  readonly uri: string;
  readonly url: URL;
  readonly options: ProviderOptions;

  constructor(url: URL, options: ProviderOptions = {}) {
    this.url = url;
    this.uri = url.href;
    this.options = options;
  }

  async build(): Promise<ContextEntry[]> {
    return [];
  }
}

// Another test provider
class AnotherProvider implements ContextProvider {
  readonly scheme = 'another';
  readonly supportedTypes = ['type3'];
  readonly uri: string;

  constructor(url: URL, _options?: ProviderOptions) {
    this.uri = url.href;
  }

  async build(): Promise<ContextEntry[]> {
    return [];
  }
}

describe('Context Registry', () => {
  beforeEach(() => {
    clearContextProviders();
  });

  afterEach(() => {
    clearContextProviders();
  });

  describe('registerContextProvider', () => {
    it('should add provider to registry', () => {
      registerContextProvider('test', TestProvider);

      expect(isContextSchemeSupported('test')).toBe(true);
    });

    it('should allow registering multiple providers', () => {
      registerContextProvider('test', TestProvider);
      registerContextProvider('another', AnotherProvider);

      expect(isContextSchemeSupported('test')).toBe(true);
      expect(isContextSchemeSupported('another')).toBe(true);
    });

    it('should overwrite existing provider for same scheme', () => {
      registerContextProvider('test', TestProvider);
      registerContextProvider('test', AnotherProvider);

      const provider = createContextProvider('test://resource');
      expect(provider.scheme).toBe('another');
    });
  });

  describe('isContextSchemeSupported', () => {
    it('should return true for registered schemes', () => {
      registerContextProvider('test', TestProvider);

      expect(isContextSchemeSupported('test')).toBe(true);
    });

    it('should return false for unregistered schemes', () => {
      expect(isContextSchemeSupported('unknown')).toBe(false);
    });

    it('should return false after clearing providers', () => {
      registerContextProvider('test', TestProvider);
      clearContextProviders();

      expect(isContextSchemeSupported('test')).toBe(false);
    });
  });

  describe('getRegisteredSchemes', () => {
    it('should return empty array when no providers registered', () => {
      expect(getRegisteredSchemes()).toEqual([]);
    });

    it('should return all registered schemes', () => {
      registerContextProvider('test', TestProvider);
      registerContextProvider('another', AnotherProvider);

      const schemes = getRegisteredSchemes();
      expect(schemes).toHaveLength(2);
      expect(schemes).toContain('test');
      expect(schemes).toContain('another');
    });
  });

  describe('createContextProvider', () => {
    beforeEach(() => {
      registerContextProvider('test', TestProvider);
    });

    it('should return provider instance for valid URI', () => {
      const provider = createContextProvider('test://resource/path');

      expect(provider).toBeInstanceOf(TestProvider);
      expect(provider.scheme).toBe('test');
      expect(provider.uri).toBe('test://resource/path');
    });

    it('should pass options to provider constructor', () => {
      const options: ProviderOptions = {
        trustAuthors: ['user1', 'user2'],
        trustAllAuthors: false,
      };

      const provider = createContextProvider(
        'test://resource',
        options
      ) as TestProvider;

      expect(provider.options).toEqual(options);
    });

    it('should throw ContextUriParseError for malformed URI', () => {
      expect(() => {
        createContextProvider('not a valid uri');
      }).toThrow(ContextUriParseError);

      try {
        createContextProvider(':::invalid');
      } catch (error) {
        expect(error).toBeInstanceOf(ContextUriParseError);
        expect((error as ContextUriParseError).uri).toBe(':::invalid');
      }
    });

    it('should throw ContextSchemeNotSupportedError for unknown scheme', () => {
      expect(() => {
        createContextProvider('unknown://resource');
      }).toThrow(ContextSchemeNotSupportedError);

      try {
        createContextProvider('ftp://example.com');
      } catch (error) {
        expect(error).toBeInstanceOf(ContextSchemeNotSupportedError);
        expect((error as ContextSchemeNotSupportedError).scheme).toBe('ftp');
      }
    });

    it('should correctly extract scheme from URI', () => {
      registerContextProvider('https', AnotherProvider);

      const provider = createContextProvider('https://example.com/path');

      expect(provider.scheme).toBe('another');
    });
  });

  describe('URI parsing', () => {
    beforeEach(() => {
      registerContextProvider('github', TestProvider);
      registerContextProvider('file', TestProvider);
      registerContextProvider('https', TestProvider);
    });

    describe('valid URIs', () => {
      it('should parse custom provider scheme:path format (github:issue/15)', () => {
        const provider = createContextProvider(
          'github:issue/15'
        ) as TestProvider;

        expect(provider.url.protocol).toBe('github:');
        expect(provider.url.pathname).toBe('issue/15');
      });

      it('should parse cross-repo reference (github:owner/repo/pr/42)', () => {
        const provider = createContextProvider(
          'github:owner/repo/pr/42'
        ) as TestProvider;

        expect(provider.url.protocol).toBe('github:');
        expect(provider.url.pathname).toBe('owner/repo/pr/42');
      });

      it('should parse file URI with absolute path (file:///absolute/path.md)', () => {
        const provider = createContextProvider(
          'file:///absolute/path.md'
        ) as TestProvider;

        expect(provider.url.protocol).toBe('file:');
        expect(provider.url.pathname).toBe('/absolute/path.md');
      });

      it('should parse standard https URL', () => {
        const provider = createContextProvider(
          'https://example.com/doc.md'
        ) as TestProvider;

        expect(provider.url.protocol).toBe('https:');
        expect(provider.url.hostname).toBe('example.com');
        expect(provider.url.pathname).toBe('/doc.md');
      });

      it('should parse URI with query parameters', () => {
        const provider = createContextProvider(
          'https://example.com/path?foo=bar&baz=qux'
        ) as TestProvider;

        expect(provider.url.searchParams.get('foo')).toBe('bar');
        expect(provider.url.searchParams.get('baz')).toBe('qux');
      });

      it('should parse URI with fragment', () => {
        const provider = createContextProvider(
          'https://example.com/doc.md#section'
        ) as TestProvider;

        expect(provider.url.hash).toBe('#section');
      });
    });

    describe('invalid URIs', () => {
      it('should reject empty URI', () => {
        expect(() => {
          createContextProvider('');
        }).toThrow(ContextUriParseError);
      });

      it('should reject URI without scheme', () => {
        expect(() => {
          createContextProvider('just-a-path');
        }).toThrow(ContextUriParseError);
      });

      it('should reject malformed URIs', () => {
        expect(() => {
          createContextProvider('://missing-scheme');
        }).toThrow(ContextUriParseError);
      });
    });

    describe('normalization', () => {
      it('should normalize file:/ to file:///', () => {
        const provider = createContextProvider(
          'file:/absolute/path.md'
        ) as TestProvider;

        // URL API normalizes file:/ to file:///
        expect(provider.url.href).toBe('file:///absolute/path.md');
      });

      it('should preserve original URI in provider', () => {
        const originalUri = 'https://example.com/path';
        const provider = createContextProvider(originalUri) as TestProvider;

        expect(provider.uri).toBe(originalUri);
      });

      it('should normalize hostname to lowercase', () => {
        const provider = createContextProvider(
          'https://EXAMPLE.COM/path'
        ) as TestProvider;

        expect(provider.url.hostname).toBe('example.com');
      });
    });
  });

  describe('clearContextProviders', () => {
    it('should remove all registered providers', () => {
      registerContextProvider('test', TestProvider);
      registerContextProvider('another', AnotherProvider);

      clearContextProviders();

      expect(getRegisteredSchemes()).toEqual([]);
      expect(isContextSchemeSupported('test')).toBe(false);
      expect(isContextSchemeSupported('another')).toBe(false);
    });
  });
});
