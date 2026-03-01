import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ACPClient } from '../acp-client.js';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';

function legacyUsageUpdateNotification(amount: number, currency: string): any {
  return {
    sessionId: 'session-1',
    update: {
      sessionUpdate: 'usage_update',
      cost: {
        amount,
        currency,
      },
    },
  };
}

describe('ACPClient', () => {
  describe('cost tracking', () => {
    it('tracks cumulative prompt cost from usage_update session events', async () => {
      const client = new ACPClient();

      client.startCapturing();
      await client.sessionUpdate(legacyUsageUpdateNotification(1.25, 'USD'));

      expect(client.getLastPromptCost()).toEqual({
        amount: 1.25,
        currency: 'USD',
      });
    });

    it('reports only the incremental cost within the current capture window', async () => {
      const client = new ACPClient();

      await client.sessionUpdate(legacyUsageUpdateNotification(2, 'USD'));

      client.startCapturing();

      await client.sessionUpdate(legacyUsageUpdateNotification(2.75, 'USD'));

      expect(client.getLastPromptCost()).toEqual({
        amount: 0.75,
        currency: 'USD',
      });
    });

    it('returns zero cost when no usage_update events received during capture', () => {
      const client = new ACPClient();
      client.startCapturing();
      client.stopCapturing();

      expect(client.getLastPromptCost()).toEqual({
        amount: 0,
        currency: 'USD',
      });
    });

    it('ignores non-finite cost amounts', async () => {
      const client = new ACPClient();

      client.startCapturing();
      await client.sessionUpdate(legacyUsageUpdateNotification(NaN, 'USD'));

      // NaN is not finite, so cumulative should stay at 0
      expect(client.getLastPromptCost().amount).toBe(0);
    });

    it('tracks currency changes', async () => {
      const client = new ACPClient();

      client.startCapturing();
      await client.sessionUpdate(legacyUsageUpdateNotification(5.0, 'EUR'));

      expect(client.getLastPromptCost().currency).toBe('EUR');
    });

    it('ignores empty string currency', async () => {
      const client = new ACPClient();

      client.startCapturing();
      await client.sessionUpdate(legacyUsageUpdateNotification(1.0, ''));

      // Empty currency should not override default
      expect(client.getLastPromptCost().currency).toBe('USD');
    });
  });

  describe('readTextFile directory listing', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'acp-dir-test-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('returns a formatted listing when path is a directory', async () => {
      writeFileSync(join(tempDir, 'file.txt'), 'content');
      mkdirSync(join(tempDir, 'subdir'));

      const client = new ACPClient();
      const result = await client.readTextFile!({
        path: tempDir,
      } as any);

      expect(result.content).toContain('Directory listing for');
      expect(result.content).toContain('file.txt');
      expect(result.content).toContain('subdir/');
    });

    it('handles non-existent paths via onFileNotFound', () => {
      const client = new ACPClient();
      // Non-existent paths hit ENOENT → onFileNotFound → throws synchronously
      expect(() =>
        client.readTextFile!({ path: '/nonexistent/restricted/dir' } as any)
      ).toThrow();
    });
  });

  describe('formatDirectoryListing error handling', () => {
    it('lists broken symlinks gracefully without crashing', async () => {
      const client = new ACPClient();
      const tempDir = mkdtempSync(join(tmpdir(), 'acp-err-test-'));
      try {
        // Create a valid file and a broken symlink in the same directory.
        // The broken symlink triggers a statSync error inside
        // formatDirectoryListing, exercising the per-entry catch path.
        writeFileSync(join(tempDir, 'good.txt'), 'content');
        symlinkSync('/nonexistent/target', join(tempDir, 'broken-link'));

        const result = await client.readTextFile!({
          path: tempDir,
        } as any);

        // Both entries appear in the listing (broken symlink is listed
        // without a directory suffix since statSync failed).
        expect(result.content).toContain('good.txt');
        expect(result.content).toContain('broken-link');
        expect(result.content).toContain('Directory listing');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
