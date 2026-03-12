import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('rover-core', async () => {
  const actual =
    await vi.importActual<typeof import('rover-core')>('rover-core');
  return {
    ...actual,
    launch: vi.fn(),
  };
});

import { launch } from 'rover-core';
import { MemoryStore } from '../store.js';

const launchMock = vi.mocked(launch);

// Shorthand to create a resolved value compatible with the launch return type.
// biome-ignore lint/suspicious/noExplicitAny: mock return value
const mockResult = (extra: Record<string, unknown> = {}) => extra as any;

describe('MemoryStore', () => {
  let store: MemoryStore;
  let basePath: string;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'memory-store-test-'));
    store = new MemoryStore(basePath, 'rover-test-project');
    launchMock.mockReset();
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
  });

  describe('ensureSetup', () => {
    it('creates the daily directory', async () => {
      launchMock.mockRejectedValue(new Error('not found'));

      await store.ensureSetup();

      const dailyPath = join(basePath, 'daily');
      expect(existsSync(dailyPath)).toBe(true);
    });

    it('registers QMD collection when available', async () => {
      launchMock.mockResolvedValue(mockResult());

      await store.ensureSetup();

      expect(launchMock).toHaveBeenCalledWith('qmd', ['--version']);
      expect(launchMock).toHaveBeenCalledWith('qmd', [
        'collection',
        'add',
        join(basePath, 'daily'),
        '--name',
        'rover-test-project',
      ]);
      expect(launchMock).toHaveBeenCalledWith('qmd', [
        'context',
        'add',
        'rover-test-project',
        'Rover autopilot daily activity logs. Each file is one day of trace summaries.',
      ]);
    });

    it('skips QMD registration when unavailable', async () => {
      launchMock.mockRejectedValue(new Error('not found'));

      await store.ensureSetup();

      expect(launchMock).toHaveBeenCalledTimes(1);
      expect(launchMock).toHaveBeenCalledWith('qmd', ['--version']);
    });
  });

  describe('appendDailyEntry', () => {
    beforeEach(async () => {
      launchMock.mockRejectedValue(new Error('not found'));
      await store.ensureSetup();
    });

    it('creates a daily log file with header and entry', () => {
      store.appendDailyEntry('test entry');

      const today = new Date().toISOString().slice(0, 10);
      const filePath = join(basePath, 'daily', `${today}.md`);

      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf8');
      expect(content).toContain(`# Daily Activity Log — ${today}`);
      expect(content).toContain('test entry');
    });

    it('appends to existing daily log without duplicating header', () => {
      store.appendDailyEntry('first entry');
      store.appendDailyEntry('second entry');

      const today = new Date().toISOString().slice(0, 10);
      const filePath = join(basePath, 'daily', `${today}.md`);

      const content = readFileSync(filePath, 'utf8');
      const headerCount = content.split('# Daily Activity Log').length - 1;
      expect(headerCount).toBe(1);
      expect(content).toContain('first entry');
      expect(content).toContain('second entry');
    });
  });

  describe('search', () => {
    it('returns empty when QMD is unavailable', async () => {
      launchMock.mockRejectedValue(new Error('not found'));

      const results = await store.search('test query');
      expect(results).toEqual([]);
    });

    it('parses flat array results from QMD', async () => {
      const qmdResults = [
        { file: 'day1.md', content: 'matched text', score: 0.9 },
        { file: 'day2.md', content: 'another match', score: 0.5 },
      ];

      launchMock.mockResolvedValueOnce(mockResult()); // --version
      launchMock.mockResolvedValueOnce(
        mockResult({ stdout: JSON.stringify(qmdResults) })
      );

      const results = await store.search('test query', 2);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        file: 'day1.md',
        content: 'matched text',
        score: 0.9,
      });
    });

    it('parses wrapped results format from QMD', async () => {
      const qmdOutput = {
        results: [{ path: 'file.md', text: 'some text', score: 0.7 }],
      };

      launchMock.mockResolvedValueOnce(mockResult()); // --version
      launchMock.mockResolvedValueOnce(
        mockResult({ stdout: JSON.stringify(qmdOutput) })
      );

      const results = await store.search('query');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        file: 'file.md',
        content: 'some text',
        score: 0.7,
      });
    });

    it('returns empty for empty stdout', async () => {
      launchMock.mockResolvedValueOnce(mockResult()); // --version
      launchMock.mockResolvedValueOnce(mockResult({ stdout: '' }));

      const results = await store.search('query');
      expect(results).toEqual([]);
    });
  });

  describe('update', () => {
    it('is a no-op when QMD is unavailable', async () => {
      launchMock.mockRejectedValue(new Error('not found'));

      await store.update();

      expect(launchMock).toHaveBeenCalledTimes(1);
    });

    it('triggers QMD update when available', async () => {
      launchMock.mockResolvedValue(mockResult());

      await store.update();

      // Wait for the queued update to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(launchMock).toHaveBeenCalledWith('qmd', ['update']);
    });
  });

  describe('QMD availability caching', () => {
    it('caches availability after first check', async () => {
      launchMock.mockRejectedValue(new Error('not found'));

      await store.search('q1');
      await store.search('q2');

      expect(
        launchMock.mock.calls.filter(
          c => c[0] === 'qmd' && c[1]?.[0] === '--version'
        )
      ).toHaveLength(1);
    });
  });

  describe('queue serialization', () => {
    it('serializes concurrent QMD operations', async () => {
      const callOrder: number[] = [];
      let callCount = 0;

      launchMock.mockImplementation((_cmd, args) => {
        if (args?.[0] === '--version') return mockResult();

        const idx = ++callCount;
        callOrder.push(idx);
        return new Promise(resolve => {
          setTimeout(
            () =>
              resolve(
                mockResult({
                  stdout: JSON.stringify([
                    { file: `result-${idx}.md`, content: 'text', score: 1 },
                  ]),
                })
              ),
            10
          );
        });
      });

      const [r1, r2] = await Promise.all([
        store.search('query1'),
        store.search('query2'),
      ]);

      expect(r1).toHaveLength(1);
      expect(r2).toHaveLength(1);
      expect(callOrder).toEqual([1, 2]);
    });
  });

  describe('collectionName', () => {
    it('is derived from constructor argument', () => {
      expect(store.collectionName).toBe('rover-test-project');
    });
  });
});
