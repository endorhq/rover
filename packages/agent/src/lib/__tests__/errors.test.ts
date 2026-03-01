import { describe, it, expect } from 'vitest';
import {
  parseAgentError,
  RateLimitError,
  AuthenticationError,
  NetworkError,
  ToolExecutionError,
  PermissionError,
  InvalidModelError,
  GenericAgentError,
} from '../errors.js';

describe('parseAgentError', () => {
  describe('credit/usage limit detection', () => {
    it('should classify "hit your limit" as RateLimitError', () => {
      const error = parseAgentError(
        "You've hit your limit · resets 2pm",
        '',
        1,
        'claude'
      );
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.isRetryable).toBe(true);
    });

    it('should classify "usage limit" as RateLimitError', () => {
      const error = parseAgentError(
        'You have reached your usage limit for this billing period',
        '',
        1,
        'claude'
      );
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.isRetryable).toBe(true);
    });

    it('should classify "plan limit" as RateLimitError', () => {
      const error = parseAgentError(
        'You have reached your plan limit',
        '',
        1,
        'claude'
      );
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.isRetryable).toBe(true);
    });
  });

  describe('auth error with credit/billing keywords → RateLimitError', () => {
    it('should classify auth error with "insufficient credit balance" as RateLimitError', () => {
      const jsonError = JSON.stringify({
        error: {
          type: 'authentication_error',
          message: 'Your account has insufficient credit balance',
        },
      });
      const error = parseAgentError(jsonError, '', 1, 'claude');
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.isRetryable).toBe(true);
    });

    it('should classify auth error with "billing limit" as RateLimitError', () => {
      const jsonError = JSON.stringify({
        error: {
          type: 'authentication_error',
          message: 'Billing limit reached for this account',
        },
      });
      const error = parseAgentError(jsonError, '', 1, 'claude');
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.isRetryable).toBe(true);
    });

    it('should classify auth error with "quota exceeded" as RateLimitError', () => {
      const jsonError = JSON.stringify({
        error: {
          type: 'authentication_error',
          message: 'API quota exceeded for this account',
        },
      });
      const error = parseAgentError(jsonError, '', 1, 'claude');
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.isRetryable).toBe(true);
    });

    it('should classify auth error with "limit reached" as RateLimitError', () => {
      const jsonError = JSON.stringify({
        error: {
          type: 'authentication_error',
          message: 'Usage limit reached for your plan',
        },
      });
      const error = parseAgentError(jsonError, '', 1, 'claude');
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.isRetryable).toBe(true);
    });
  });

  describe('normal auth errors remain AuthenticationError', () => {
    it('should classify "invalid api key" as AuthenticationError', () => {
      const jsonError = JSON.stringify({
        error: {
          type: 'authentication_error',
          message: 'invalid api key',
        },
      });
      const error = parseAgentError(jsonError, '', 1, 'claude');
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.isRetryable).toBe(false);
    });

    it('should classify standard auth error as AuthenticationError', () => {
      const jsonError = JSON.stringify({
        error: {
          type: 'authentication_error',
          message: 'Invalid bearer token',
        },
      });
      const error = parseAgentError(jsonError, '', 1, 'claude');
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.isRetryable).toBe(false);
    });

    it('should NOT reclassify "billing is not configured" as RateLimitError', () => {
      const jsonError = JSON.stringify({
        error: {
          type: 'authentication_error',
          message: 'Your billing is not configured',
        },
      });
      const error = parseAgentError(jsonError, '', 1, 'claude');
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.isRetryable).toBe(false);
    });

    it('should NOT reclassify "account balance" without insufficiency as RateLimitError', () => {
      const jsonError = JSON.stringify({
        error: {
          type: 'authentication_error',
          message: 'Could not retrieve account balance',
        },
      });
      const error = parseAgentError(jsonError, '', 1, 'claude');
      expect(error).toBeInstanceOf(AuthenticationError);
      expect(error.isRetryable).toBe(false);
    });
  });

  describe('network errors', () => {
    it('should classify ECONNREFUSED as NetworkError', () => {
      const error = parseAgentError(
        'connect ECONNREFUSED 127.0.0.1:443',
        '',
        1,
        'claude'
      );
      expect(error).toBeInstanceOf(NetworkError);
      expect(error.isRetryable).toBe(true);
    });

    it('should classify ETIMEDOUT as NetworkError', () => {
      const error = parseAgentError(
        'connect ETIMEDOUT 1.2.3.4:443',
        '',
        1,
        'claude'
      );
      expect(error).toBeInstanceOf(NetworkError);
      expect(error.isRetryable).toBe(true);
    });

    it('should classify connection_failed as NetworkError', () => {
      const error = parseAgentError(
        'connection failed to api.anthropic.com',
        '',
        1,
        'claude'
      );
      expect(error).toBeInstanceOf(NetworkError);
      expect(error.isRetryable).toBe(true);
    });
  });

  describe('rate limit errors', () => {
    it('should classify "429" as RateLimitError', () => {
      const error = parseAgentError(
        'HTTP 429 Too Many Requests',
        '',
        1,
        'claude'
      );
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.isRetryable).toBe(true);
    });

    it('should classify "rate limit" as RateLimitError', () => {
      const error = parseAgentError('rate limit exceeded', '', 1, 'gemini');
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.isRetryable).toBe(true);
    });
  });

  describe('tool execution errors', () => {
    it('should classify FatalToolExecutionError as ToolExecutionError', () => {
      const error = parseAgentError(
        'FatalToolExecutionError: invalid path',
        '',
        1,
        'claude'
      );
      expect(error).toBeInstanceOf(ToolExecutionError);
      expect(error.isRetryable).toBe(false);
    });
  });

  describe('permission errors', () => {
    it('should classify "permission denied" as PermissionError', () => {
      const error = parseAgentError(
        'permission denied for resource',
        '',
        1,
        'claude'
      );
      expect(error).toBeInstanceOf(PermissionError);
      expect(error.isRetryable).toBe(false);
    });

    it('should classify "403" as PermissionError', () => {
      const error = parseAgentError('HTTP 403 Forbidden', '', 1, 'claude');
      expect(error).toBeInstanceOf(PermissionError);
      expect(error.isRetryable).toBe(false);
    });
  });

  describe('invalid model errors', () => {
    it('should classify "model not found" as InvalidModelError', () => {
      const error = parseAgentError('model not found: gpt-99', '', 1, 'claude');
      expect(error).toBeInstanceOf(InvalidModelError);
      expect(error.isRetryable).toBe(false);
    });
  });

  describe('generic errors', () => {
    it('should classify unrecognized errors as GenericAgentError', () => {
      const error = parseAgentError(
        'something completely unknown happened',
        '',
        1,
        'claude'
      );
      expect(error).toBeInstanceOf(GenericAgentError);
      expect(error.isRetryable).toBe(false);
    });
  });
});
