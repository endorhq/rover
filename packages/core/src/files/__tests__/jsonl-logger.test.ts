import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlLogger } from '../jsonl-logger.js';

describe('JsonlLogger', () => {
  let testDir: string;
  let logFilePath: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'rover-jsonl-test-'));
    logFilePath = join(testDir, 'logs.jsonl');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should create parent directories if they do not exist', () => {
      const nestedPath = join(testDir, 'a', 'b', 'c', 'logs.jsonl');
      const logger = new JsonlLogger(nestedPath);
      expect(logger.path).toBe(nestedPath);
      expect(existsSync(join(testDir, 'a', 'b', 'c'))).toBe(true);
    });
  });

  describe('path getter', () => {
    it('should return the file path', () => {
      const logger = new JsonlLogger(logFilePath);
      expect(logger.path).toBe(logFilePath);
    });
  });

  describe('log', () => {
    it('should write a valid entry as a single JSONL line', () => {
      const logger = new JsonlLogger(logFilePath);
      logger.log({
        timestamp: '2025-01-01T00:00:00.000Z',
        level: 'info',
        event: 'workflow_start',
        message: 'Starting workflow',
      });

      const content = readFileSync(logFilePath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.level).toBe('info');
      expect(parsed.event).toBe('workflow_start');
      expect(parsed.message).toBe('Starting workflow');
    });

    it('should append multiple entries on separate lines', () => {
      const logger = new JsonlLogger(logFilePath);
      logger.log({
        timestamp: '2025-01-01T00:00:00.000Z',
        level: 'info',
        event: 'step_start',
        message: 'Step 1',
      });
      logger.log({
        timestamp: '2025-01-01T00:00:01.000Z',
        level: 'info',
        event: 'step_complete',
        message: 'Step 1 done',
      });

      const content = readFileSync(logFilePath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).event).toBe('step_start');
      expect(JSON.parse(lines[1]).event).toBe('step_complete');
    });

    it('should not throw on invalid entries (logs warning instead)', () => {
      const logger = new JsonlLogger(logFilePath);
      // Invalid: missing required fields
      expect(() =>
        logger.log({
          timestamp: 'x',
          level: 'invalid' as any,
          event: 'bad' as any,
          message: 'test',
        })
      ).not.toThrow();
    });

    it('should handle entries with optional fields', () => {
      const logger = new JsonlLogger(logFilePath);
      logger.log({
        timestamp: '2025-01-01T00:00:00.000Z',
        level: 'error',
        event: 'step_fail',
        message: 'Step failed',
        taskId: 'task-1',
        stepId: 'step-1',
        stepName: 'Build',
        agent: 'claude',
        duration: 10.5,
        tokens: 500,
        cost: 0.01,
        model: 'claude-opus-4-20250514',
        error: 'Build error',
        errorCode: 'BUILD_FAILED',
        errorRetryable: true,
        progress: 50,
        metadata: { retry: 1 },
      });

      const content = readFileSync(logFilePath, 'utf8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.taskId).toBe('task-1');
      expect(parsed.duration).toBe(10.5);
      expect(parsed.tokens).toBe(500);
      expect(parsed.metadata).toEqual({ retry: 1 });
    });

    it('should handle UTF-8 content in messages', () => {
      const logger = new JsonlLogger(logFilePath);
      logger.log({
        timestamp: '2025-01-01T00:00:00.000Z',
        level: 'info',
        event: 'workflow_start',
        message:
          'Workflow with special chars: \u00e9\u00e8\u00ea \u00fc\u00f6\u00e4 \u4f60\u597d',
      });

      const content = readFileSync(logFilePath, 'utf8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.message).toContain('\u00e9\u00e8\u00ea');
      expect(parsed.message).toContain('\u4f60\u597d');
    });
  });

  describe('convenience methods', () => {
    it('info() should set level to info', () => {
      const logger = new JsonlLogger(logFilePath);
      logger.info('workflow_start', 'Starting');

      const content = readFileSync(logFilePath, 'utf8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.level).toBe('info');
      expect(parsed.event).toBe('workflow_start');
      expect(parsed.message).toBe('Starting');
      expect(parsed.timestamp).toBeDefined();
    });

    it('warn() should set level to warn', () => {
      const logger = new JsonlLogger(logFilePath);
      logger.warn('agent_recovery', 'Recovered', { agent: 'claude' });

      const content = readFileSync(logFilePath, 'utf8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.level).toBe('warn');
      expect(parsed.agent).toBe('claude');
    });

    it('error() should set level to error', () => {
      const logger = new JsonlLogger(logFilePath);
      logger.error('workflow_fail', 'Failed', {
        error: 'Something went wrong',
      });

      const content = readFileSync(logFilePath, 'utf8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.level).toBe('error');
      expect(parsed.error).toBe('Something went wrong');
    });

    it('debug() should set level to debug', () => {
      const logger = new JsonlLogger(logFilePath);
      logger.debug('step_start', 'Debug info');

      const content = readFileSync(logFilePath, 'utf8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.level).toBe('debug');
    });

    it('convenience methods should merge additional fields', () => {
      const logger = new JsonlLogger(logFilePath);
      logger.info('step_complete', 'Step done', {
        stepId: 'step-1',
        duration: 5.5,
        tokens: 100,
      });

      const content = readFileSync(logFilePath, 'utf8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.stepId).toBe('step-1');
      expect(parsed.duration).toBe(5.5);
      expect(parsed.tokens).toBe(100);
    });
  });

  describe('readAll', () => {
    it('should return empty array for non-existent file', () => {
      const entries = JsonlLogger.readAll(join(testDir, 'nonexistent.jsonl'));
      expect(entries).toEqual([]);
    });

    it('should read all valid entries', () => {
      const logger = new JsonlLogger(logFilePath);
      logger.info('workflow_start', 'Start');
      logger.info('step_start', 'Step 1');
      logger.info('step_complete', 'Step 1 done');
      logger.info('workflow_complete', 'Done');

      const entries = JsonlLogger.readAll(logFilePath);
      expect(entries).toHaveLength(4);
      expect(entries[0].event).toBe('workflow_start');
      expect(entries[3].event).toBe('workflow_complete');
    });

    it('should skip invalid lines', () => {
      const logger = new JsonlLogger(logFilePath);
      logger.info('workflow_start', 'Start');

      // Manually append an invalid line
      const { appendFileSync } = require('node:fs');
      appendFileSync(logFilePath, 'this is not json\n');
      appendFileSync(logFilePath, '{"invalid": true}\n');

      logger.info('workflow_complete', 'Done');

      const entries = JsonlLogger.readAll(logFilePath);
      expect(entries).toHaveLength(2);
      expect(entries[0].event).toBe('workflow_start');
      expect(entries[1].event).toBe('workflow_complete');
    });

    it('should handle empty file', () => {
      const { writeFileSync } = require('node:fs');
      writeFileSync(logFilePath, '');
      const entries = JsonlLogger.readAll(logFilePath);
      expect(entries).toEqual([]);
    });
  });
});
