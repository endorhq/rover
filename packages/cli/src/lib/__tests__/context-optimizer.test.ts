import { describe, expect, it, vi } from 'vitest';
import {
  findConflictRegions,
  truncateConflictContext,
  getBlameContext,
} from '../context-optimizer.js';

describe('context-optimizer', () => {
  describe('findConflictRegions', () => {
    it('should find a single conflict region', () => {
      const content = [
        'line 0',
        'line 1',
        '<<<<<<< HEAD',
        'our change',
        '=======',
        'their change',
        '>>>>>>> branch',
        'line 7',
      ].join('\n');

      const regions = findConflictRegions(content);
      expect(regions).toEqual([{ startLine: 2, endLine: 6 }]);
    });

    it('should find multiple conflict regions', () => {
      const content = [
        'line 0',
        '<<<<<<< HEAD',
        'ours1',
        '=======',
        'theirs1',
        '>>>>>>> branch',
        'line 6',
        '<<<<<<< HEAD',
        'ours2',
        '=======',
        'theirs2',
        '>>>>>>> branch',
        'line 12',
      ].join('\n');

      const regions = findConflictRegions(content);
      expect(regions).toEqual([
        { startLine: 1, endLine: 5 },
        { startLine: 7, endLine: 11 },
      ]);
    });

    it('should return empty array for no conflicts', () => {
      const content = 'just some normal code\nwith multiple lines';
      expect(findConflictRegions(content)).toEqual([]);
    });
  });

  describe('truncateConflictContext', () => {
    it('should truncate content around a single conflict', () => {
      // Build a file with 200 lines, conflict at lines 100-104
      const lines: string[] = [];
      for (let i = 0; i < 200; i++) {
        lines.push(`line ${i}`);
      }
      lines[100] = '<<<<<<< HEAD';
      lines[101] = 'our change';
      lines[102] = '=======';
      lines[103] = 'their change';
      lines[104] = '>>>>>>> branch';

      const content = lines.join('\n');
      const result = truncateConflictContext(content, 5);

      // Should have omitted lines before and after
      expect(result.content).toContain('// ... 95 lines omitted ...');
      expect(result.content).toContain('<<<<<<< HEAD');
      expect(result.content).toContain('>>>>>>> branch');
      expect(result.content).toContain('line 95'); // 5 lines before conflict
      expect(result.content).toContain('line 109'); // 5 lines after conflict
      expect(result.content).not.toContain('line 94');
      expect(result.content).not.toContain('line 110');
    });

    it('should merge overlapping context windows', () => {
      // Two conflicts close together (within context window)
      const lines: string[] = [];
      for (let i = 0; i < 50; i++) {
        lines.push(`line ${i}`);
      }
      lines[10] = '<<<<<<< HEAD';
      lines[11] = 'ours1';
      lines[12] = '=======';
      lines[13] = 'theirs1';
      lines[14] = '>>>>>>> branch';
      lines[20] = '<<<<<<< HEAD';
      lines[21] = 'ours2';
      lines[22] = '=======';
      lines[23] = 'theirs2';
      lines[24] = '>>>>>>> branch';

      const content = lines.join('\n');
      const result = truncateConflictContext(content, 10);

      // With context=10, window1=[0,24], window2=[10,34] → merged to [0,34]
      // So there should be only one omitted section at the end
      const omittedMatches = result.content.match(
        /\/\/ \.\.\. \d+ lines omitted \.\.\./g
      );
      expect(omittedMatches?.length).toBe(1); // Only trailing omission
    });

    it('should return full content when no conflicts', () => {
      const content = 'line 1\nline 2\nline 3';
      const result = truncateConflictContext(content, 5);
      expect(result.content).toBe(content);
      expect(result.conflictRegions).toEqual([]);
    });

    it('should handle conflict at start of file', () => {
      const lines = [
        '<<<<<<< HEAD',
        'ours',
        '=======',
        'theirs',
        '>>>>>>> branch',
        ...Array.from({ length: 100 }, (_, i) => `line ${i + 5}`),
      ];

      const result = truncateConflictContext(lines.join('\n'), 3);
      expect(result.content.startsWith('<<<<<<< HEAD')).toBe(true);
      expect(result.content).toContain('line 7'); // 3 lines after conflict ends at line 4
    });

    it('should handle conflict at end of file', () => {
      const lines = [
        ...Array.from({ length: 100 }, (_, i) => `line ${i}`),
        '<<<<<<< HEAD',
        'ours',
        '=======',
        'theirs',
        '>>>>>>> branch',
      ];

      const result = truncateConflictContext(lines.join('\n'), 3);
      expect(result.content).toContain('line 97'); // 3 lines before conflict
      expect(result.content.endsWith('>>>>>>> branch')).toBe(true);
    });
  });

  describe('getBlameContext', () => {
    it('should call getBlameCommits for each ref and deduplicate', () => {
      const mockGit = {
        getBlameCommits: vi.fn(),
      } as any;

      mockGit.getBlameCommits
        .mockReturnValueOnce([
          { hash: 'abc123', summary: 'fix: something' },
          { hash: 'def456', summary: 'feat: another' },
        ])
        .mockReturnValueOnce([
          { hash: 'abc123', summary: 'fix: something' }, // duplicate
          { hash: 'ghi789', summary: 'chore: cleanup' },
        ]);

      const regions = [{ startLine: 10, endLine: 15 }];
      const result = getBlameContext(mockGit, 'src/foo.ts', regions, {
        ours: 'HEAD',
        theirs: 'MERGE_HEAD',
      });

      expect(result).toContain('- fix: something');
      expect(result).toContain('- feat: another');
      expect(result).toContain('- chore: cleanup');
      // Should be deduplicated
      expect(result.match(/fix: something/g)?.length).toBe(1);

      expect(mockGit.getBlameCommits).toHaveBeenCalledTimes(2);
    });

    it('should return empty string when blame fails', () => {
      const mockGit = {
        getBlameCommits: vi.fn().mockImplementation(() => {
          throw new Error('blame failed');
        }),
      } as any;

      const regions = [{ startLine: 5, endLine: 10 }];
      const result = getBlameContext(mockGit, 'foo.ts', regions, {
        ours: 'HEAD',
        theirs: 'MERGE_HEAD',
      });

      expect(result).toBe('');
    });

    it('should handle multiple conflict regions', () => {
      const mockGit = {
        getBlameCommits: vi
          .fn()
          .mockReturnValue([{ hash: 'aaa', summary: 'commit A' }]),
      } as any;

      const regions = [
        { startLine: 5, endLine: 10 },
        { startLine: 20, endLine: 25 },
      ];
      const result = getBlameContext(mockGit, 'foo.ts', regions, {
        ours: 'HEAD',
        theirs: 'MERGE_HEAD',
      });

      // 2 regions × 2 refs = 4 calls
      expect(mockGit.getBlameCommits).toHaveBeenCalledTimes(4);
      expect(result).toContain('- commit A');
    });
  });
});
