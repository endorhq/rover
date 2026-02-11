import { describe, it, expect } from 'vitest';
import {
  JsonlLogEntrySchema,
  LogLevelSchema,
  LogEventSchema,
} from '../schema.js';

describe('LogLevelSchema', () => {
  it('should accept valid log levels', () => {
    expect(LogLevelSchema.parse('info')).toBe('info');
    expect(LogLevelSchema.parse('warn')).toBe('warn');
    expect(LogLevelSchema.parse('error')).toBe('error');
    expect(LogLevelSchema.parse('debug')).toBe('debug');
  });

  it('should reject invalid log levels', () => {
    expect(() => LogLevelSchema.parse('trace')).toThrow();
    expect(() => LogLevelSchema.parse('fatal')).toThrow();
    expect(() => LogLevelSchema.parse('')).toThrow();
  });
});

describe('LogEventSchema', () => {
  it('should accept all valid event types', () => {
    const events = [
      'workflow_start',
      'workflow_complete',
      'workflow_fail',
      'step_start',
      'step_complete',
      'step_fail',
      'agent_error',
      'agent_auth_error',
      'agent_timeout',
      'agent_recovery',
    ];
    for (const event of events) {
      expect(LogEventSchema.parse(event)).toBe(event);
    }
  });

  it('should reject invalid event types', () => {
    expect(() => LogEventSchema.parse('unknown_event')).toThrow();
    expect(() => LogEventSchema.parse('')).toThrow();
  });
});

describe('JsonlLogEntrySchema', () => {
  it('should validate a minimal valid entry', () => {
    const entry = {
      timestamp: '2025-01-01T00:00:00.000Z',
      level: 'info',
      event: 'workflow_start',
      message: 'Starting workflow',
    };
    const result = JsonlLogEntrySchema.parse(entry);
    expect(result.timestamp).toBe(entry.timestamp);
    expect(result.level).toBe('info');
    expect(result.event).toBe('workflow_start');
    expect(result.message).toBe('Starting workflow');
  });

  it('should validate an entry with all optional fields', () => {
    const entry = {
      timestamp: '2025-01-01T00:00:00.000Z',
      level: 'error',
      event: 'step_fail',
      message: 'Step failed',
      taskId: 'task-123',
      stepId: 'step-1',
      stepName: 'Build',
      agent: 'claude',
      duration: 42.5,
      tokens: 1500,
      cost: 0.05,
      model: 'claude-opus-4-20250514',
      error: 'Compilation error',
      errorCode: 'COMPILATION_FAILED',
      errorRetryable: false,
      progress: 50,
      metadata: { attempt: 1, custom: 'value' },
    };
    const result = JsonlLogEntrySchema.parse(entry);
    expect(result.taskId).toBe('task-123');
    expect(result.tokens).toBe(1500);
    expect(result.cost).toBe(0.05);
    expect(result.errorRetryable).toBe(false);
    expect(result.metadata).toEqual({ attempt: 1, custom: 'value' });
  });

  it('should reject entry missing required fields', () => {
    expect(() =>
      JsonlLogEntrySchema.parse({ timestamp: '2025-01-01T00:00:00.000Z' })
    ).toThrow();
    expect(() =>
      JsonlLogEntrySchema.parse({
        level: 'info',
        event: 'workflow_start',
        message: 'test',
      })
    ).toThrow();
  });

  it('should reject entry with invalid level', () => {
    expect(() =>
      JsonlLogEntrySchema.parse({
        timestamp: '2025-01-01T00:00:00.000Z',
        level: 'invalid',
        event: 'workflow_start',
        message: 'test',
      })
    ).toThrow();
  });

  it('should reject entry with invalid event', () => {
    expect(() =>
      JsonlLogEntrySchema.parse({
        timestamp: '2025-01-01T00:00:00.000Z',
        level: 'info',
        event: 'invalid_event',
        message: 'test',
      })
    ).toThrow();
  });

  it('should allow optional fields to be undefined', () => {
    const entry = {
      timestamp: '2025-01-01T00:00:00.000Z',
      level: 'info',
      event: 'workflow_start',
      message: 'Starting',
    };
    const result = JsonlLogEntrySchema.parse(entry);
    expect(result.taskId).toBeUndefined();
    expect(result.stepId).toBeUndefined();
    expect(result.duration).toBeUndefined();
    expect(result.tokens).toBeUndefined();
    expect(result.cost).toBeUndefined();
    expect(result.model).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.metadata).toBeUndefined();
  });
});
