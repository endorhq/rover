import { describe, expect, it } from 'vitest';
import {
  ContextError,
  ContextSchemeNotSupportedError,
  ContextUriParseError,
  ContextTypeNotSupportedError,
  ContextFetchError,
} from '../errors.js';

describe('Context Errors', () => {
  describe('ContextError', () => {
    it('should have correct name property', () => {
      const error = new ContextError('test message');

      expect(error.name).toBe('ContextError');
    });

    it('should include message', () => {
      const error = new ContextError('test message');

      expect(error.message).toBe('test message');
    });

    it('should be instanceof Error', () => {
      const error = new ContextError('test');

      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('ContextSchemeNotSupportedError', () => {
    it('should have correct name property', () => {
      const error = new ContextSchemeNotSupportedError('unknown');

      expect(error.name).toBe('ContextSchemeNotSupportedError');
    });

    it('should include scheme in message', () => {
      const error = new ContextSchemeNotSupportedError('foobar');

      expect(error.message).toContain('foobar');
      expect(error.message).toBe('Unsupported context scheme: "foobar"');
    });

    it('should store scheme property', () => {
      const error = new ContextSchemeNotSupportedError('myscheme');

      expect(error.scheme).toBe('myscheme');
    });

    it('should be instanceof ContextError', () => {
      const error = new ContextSchemeNotSupportedError('test');

      expect(error).toBeInstanceOf(ContextError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('ContextUriParseError', () => {
    it('should have correct name property', () => {
      const error = new ContextUriParseError('bad://uri', 'invalid format');

      expect(error.name).toBe('ContextUriParseError');
    });

    it('should include uri and reason in message', () => {
      const error = new ContextUriParseError('broken://uri', 'missing host');

      expect(error.message).toContain('broken://uri');
      expect(error.message).toContain('missing host');
      expect(error.message).toBe(
        'Invalid context URI "broken://uri": missing host'
      );
    });

    it('should store uri property', () => {
      const error = new ContextUriParseError('test://uri', 'reason');

      expect(error.uri).toBe('test://uri');
    });

    it('should be instanceof ContextError', () => {
      const error = new ContextUriParseError('uri', 'reason');

      expect(error).toBeInstanceOf(ContextError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('ContextTypeNotSupportedError', () => {
    it('should have correct name property', () => {
      const error = new ContextTypeNotSupportedError('github', 'discussion', [
        'issue',
        'pr',
      ]);

      expect(error.name).toBe('ContextTypeNotSupportedError');
    });

    it('should include scheme, type, and supported types in message', () => {
      const error = new ContextTypeNotSupportedError('github', 'release', [
        'issue',
        'pr',
        'discussion',
      ]);

      expect(error.message).toContain('github');
      expect(error.message).toContain('release');
      expect(error.message).toContain('issue, pr, discussion');
      expect(error.message).toBe(
        'Provider "github" does not support type "release". ' +
          'Supported types: issue, pr, discussion'
      );
    });

    it('should store scheme, type, and supportedTypes properties', () => {
      const error = new ContextTypeNotSupportedError('file', 'directory', [
        'absolute',
        'relative',
      ]);

      expect(error.scheme).toBe('file');
      expect(error.type).toBe('directory');
      expect(error.supportedTypes).toEqual(['absolute', 'relative']);
    });

    it('should be instanceof ContextError', () => {
      const error = new ContextTypeNotSupportedError('s', 't', []);

      expect(error).toBeInstanceOf(ContextError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('ContextFetchError', () => {
    it('should have correct name property', () => {
      const error = new ContextFetchError(
        'github:issue/123',
        'network timeout'
      );

      expect(error.name).toBe('ContextFetchError');
    });

    it('should include uri and reason in message', () => {
      const error = new ContextFetchError(
        'file:./missing.md',
        'file not found'
      );

      expect(error.message).toContain('file:./missing.md');
      expect(error.message).toContain('file not found');
      expect(error.message).toBe(
        'Failed to fetch context from "file:./missing.md": file not found'
      );
    });

    it('should store uri and reason properties', () => {
      const error = new ContextFetchError('test://uri', 'some reason');

      expect(error.uri).toBe('test://uri');
      expect(error.reason).toBe('some reason');
    });

    it('should be instanceof ContextError', () => {
      const error = new ContextFetchError('uri', 'reason');

      expect(error).toBeInstanceOf(ContextError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('Error inheritance chain', () => {
    it('all context errors should be instanceof ContextError', () => {
      const errors = [
        new ContextError('base'),
        new ContextSchemeNotSupportedError('scheme'),
        new ContextUriParseError('uri', 'reason'),
        new ContextTypeNotSupportedError('scheme', 'type', []),
        new ContextFetchError('uri', 'reason'),
      ];

      for (const error of errors) {
        expect(error).toBeInstanceOf(ContextError);
        expect(error).toBeInstanceOf(Error);
      }
    });
  });
});
