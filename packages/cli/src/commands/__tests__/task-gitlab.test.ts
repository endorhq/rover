import { describe, expect, it } from 'vitest';
import { parseIssueFromContext } from '../task.js';

describe('parseIssueFromContext', () => {
  describe('GitLab URIs', () => {
    it('parses gitlab:issue/N (short form)', () => {
      expect(parseIssueFromContext(['gitlab:issue/15'])).toEqual({
        provider: 'gitlab',
        number: 15,
        projectPath: undefined,
      });
    });

    it('parses gitlab:owner/repo/issue/N', () => {
      expect(parseIssueFromContext(['gitlab:myorg/myrepo/issue/42'])).toEqual({
        provider: 'gitlab',
        number: 42,
        projectPath: 'myorg/myrepo',
      });
    });

    it('parses gitlab:group/subgroup/repo/issue/N (nested groups)', () => {
      expect(
        parseIssueFromContext(['gitlab:group/subgroup/repo/issue/7'])
      ).toEqual({
        provider: 'gitlab',
        number: 7,
        projectPath: 'group/subgroup/repo',
      });
    });
  });

  describe('GitHub URIs', () => {
    it('parses github:issue/N (short form)', () => {
      expect(parseIssueFromContext(['github:issue/15'])).toEqual({
        provider: 'github',
        number: 15,
        projectPath: undefined,
      });
    });

    it('parses github:owner/repo/issue/N', () => {
      expect(parseIssueFromContext(['github:owner/repo/issue/42'])).toEqual({
        provider: 'github',
        number: 42,
        projectPath: 'owner/repo',
      });
    });
  });

  describe('Edge cases', () => {
    it('returns null when no issue URI is present', () => {
      expect(parseIssueFromContext(['file:./docs.md'])).toBeNull();
      expect(parseIssueFromContext([])).toBeNull();
    });

    it('returns first issue when multiple URIs are provided', () => {
      expect(
        parseIssueFromContext([
          'file:./docs.md',
          'gitlab:issue/99',
          'github:issue/100',
        ])
      ).toEqual({
        provider: 'gitlab',
        number: 99,
        projectPath: undefined,
      });
    });

    it('ignores mr/pr URIs (only matches issues)', () => {
      expect(parseIssueFromContext(['gitlab:mr/42'])).toBeNull();
      expect(parseIssueFromContext(['github:pr/42'])).toBeNull();
    });

    it('ignores malformed URIs', () => {
      expect(parseIssueFromContext(['gitlab:issue/'])).toBeNull();
      expect(parseIssueFromContext(['gitlab:issue/abc'])).toBeNull();
      expect(parseIssueFromContext(['gitlab:'])).toBeNull();
      expect(parseIssueFromContext(['github:issue/'])).toBeNull();
      expect(parseIssueFromContext(['github:issue/abc'])).toBeNull();
      expect(parseIssueFromContext(['github:'])).toBeNull();
    });
  });
});
