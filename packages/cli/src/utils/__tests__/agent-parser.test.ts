import { describe, it, expect } from 'vitest';
import { parseAgentString, formatAgentWithModel } from '../agent-parser.js';
import { AI_AGENT } from 'rover-core';

describe('parseAgentString', () => {
  describe('parsing agent without model', () => {
    it('should parse "claude" as claude agent with no model', () => {
      const result = parseAgentString('claude');
      expect(result.agent).toBe(AI_AGENT.Claude);
      expect(result.model).toBeUndefined();
    });

    it('should parse "gemini" as gemini agent with no model', () => {
      const result = parseAgentString('gemini');
      expect(result.agent).toBe(AI_AGENT.Gemini);
      expect(result.model).toBeUndefined();
    });

    it('should parse "qwen" as qwen agent with no model', () => {
      const result = parseAgentString('qwen');
      expect(result.agent).toBe(AI_AGENT.Qwen);
      expect(result.model).toBeUndefined();
    });

    it('should parse "codex" as codex agent with no model', () => {
      const result = parseAgentString('codex');
      expect(result.agent).toBe(AI_AGENT.Codex);
      expect(result.model).toBeUndefined();
    });

    it('should parse "cursor" as cursor agent with no model', () => {
      const result = parseAgentString('cursor');
      expect(result.agent).toBe(AI_AGENT.Cursor);
      expect(result.model).toBeUndefined();
    });

    it('should parse "opencode" as opencode agent with no model', () => {
      const result = parseAgentString('opencode');
      expect(result.agent).toBe(AI_AGENT.OpenCode);
      expect(result.model).toBeUndefined();
    });
  });

  describe('parsing agent with model', () => {
    it('should parse "claude:opus" correctly', () => {
      const result = parseAgentString('claude:opus');
      expect(result.agent).toBe(AI_AGENT.Claude);
      expect(result.model).toBe('opus');
    });

    it('should parse "claude:sonnet" correctly', () => {
      const result = parseAgentString('claude:sonnet');
      expect(result.agent).toBe(AI_AGENT.Claude);
      expect(result.model).toBe('sonnet');
    });

    it('should parse "claude:haiku" correctly', () => {
      const result = parseAgentString('claude:haiku');
      expect(result.agent).toBe(AI_AGENT.Claude);
      expect(result.model).toBe('haiku');
    });

    it('should parse "gemini:flash" correctly', () => {
      const result = parseAgentString('gemini:flash');
      expect(result.agent).toBe(AI_AGENT.Gemini);
      expect(result.model).toBe('flash');
    });

    it('should parse "gemini:pro" correctly', () => {
      const result = parseAgentString('gemini:pro');
      expect(result.agent).toBe(AI_AGENT.Gemini);
      expect(result.model).toBe('pro');
    });

    it('should parse "qwen:plus" correctly', () => {
      const result = parseAgentString('qwen:plus');
      expect(result.agent).toBe(AI_AGENT.Qwen);
      expect(result.model).toBe('plus');
    });

    it('should parse "opencode:opus" correctly', () => {
      const result = parseAgentString('opencode:opus');
      expect(result.agent).toBe(AI_AGENT.OpenCode);
      expect(result.model).toBe('opus');
    });

    it('should handle model names with hyphens', () => {
      const result = parseAgentString('gemini:flash-2.0');
      expect(result.agent).toBe(AI_AGENT.Gemini);
      expect(result.model).toBe('flash-2.0');
    });

    it('should handle model names with colons by joining them', () => {
      const result = parseAgentString('claude:some:model:name');
      expect(result.agent).toBe(AI_AGENT.Claude);
      expect(result.model).toBe('some:model:name');
    });
  });

  describe('case insensitivity', () => {
    it('should parse "CLAUDE" as claude', () => {
      const result = parseAgentString('CLAUDE');
      expect(result.agent).toBe(AI_AGENT.Claude);
    });

    it('should parse "Claude" as claude', () => {
      const result = parseAgentString('Claude');
      expect(result.agent).toBe(AI_AGENT.Claude);
    });

    it('should parse "GEMINI:PRO" correctly', () => {
      const result = parseAgentString('GEMINI:PRO');
      expect(result.agent).toBe(AI_AGENT.Gemini);
      expect(result.model).toBe('PRO');
    });
  });

  describe('error handling', () => {
    it('should throw error for invalid agent', () => {
      expect(() => parseAgentString('invalid')).toThrow('Invalid agent');
    });

    it('should throw error for empty string', () => {
      expect(() => parseAgentString('')).toThrow('Invalid agent');
    });

    it('should throw error for unknown agent with model', () => {
      expect(() => parseAgentString('unknown:model')).toThrow('Invalid agent');
    });
  });
});

describe('formatAgentWithModel', () => {
  it('should format agent without model', () => {
    const result = formatAgentWithModel(AI_AGENT.Claude);
    expect(result).toBe('claude');
  });

  it('should format agent with undefined model', () => {
    const result = formatAgentWithModel(AI_AGENT.Claude, undefined);
    expect(result).toBe('claude');
  });

  it('should format agent with model', () => {
    const result = formatAgentWithModel(AI_AGENT.Claude, 'opus');
    expect(result).toBe('claude:opus');
  });

  it('should format gemini with model', () => {
    const result = formatAgentWithModel(AI_AGENT.Gemini, 'flash');
    expect(result).toBe('gemini:flash');
  });
});
