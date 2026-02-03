import { describe, expect, it } from 'vitest';
import type { IterationContextEntry } from 'rover-schemas';
import { generateContextIndex } from '../index-generator.js';

describe('generateContextIndex', () => {
  describe('empty entries', () => {
    it('should generate "No context" message when entries is empty', () => {
      const result = generateContextIndex([], 1);

      expect(result).toContain('# Context for Iteration 1');
      expect(result).toContain(
        'No context sources were provided for this iteration.'
      );
    });

    it('should use correct iteration number in header', () => {
      const result = generateContextIndex([], 5);

      expect(result).toContain('# Context for Iteration 5');
    });
  });

  describe('new entries', () => {
    it('should categorize entries added in current iteration as "New"', () => {
      const entries: IterationContextEntry[] = [
        {
          uri: 'github:issue/15',
          fetchedAt: '2024-01-15T10:30:00Z',
          file: 'github-issue-15.md',
          name: 'Fix login bug',
          description: 'GitHub Issue #15',
          provenance: { addedIn: 2 },
        },
      ];

      const result = generateContextIndex(entries, 2);

      expect(result).toContain('## New in this iteration');
      expect(result).toContain(
        '**Fix login bug** (`github-issue-15.md`) - GitHub Issue #15'
      );
    });

    it('should list multiple new entries', () => {
      const entries: IterationContextEntry[] = [
        {
          uri: 'github:issue/15',
          fetchedAt: '2024-01-15T10:30:00Z',
          file: 'github-issue-15.md',
          name: 'Fix login bug',
          description: 'GitHub Issue #15',
          provenance: { addedIn: 1 },
        },
        {
          uri: 'file:./docs/auth.md',
          fetchedAt: '2024-01-15T10:30:00Z',
          file: 'local-auth-md.md',
          name: 'auth.md',
          description: 'Local file ./docs/auth.md',
          provenance: { addedIn: 1 },
        },
      ];

      const result = generateContextIndex(entries, 1);

      expect(result).toContain('**Fix login bug**');
      expect(result).toContain('**auth.md**');
    });
  });

  describe('updated entries', () => {
    it('should categorize re-fetched entries as "Updated"', () => {
      const entries: IterationContextEntry[] = [
        {
          uri: 'github:issue/15',
          fetchedAt: '2024-01-15T10:30:00Z',
          file: 'github-issue-15.md',
          name: 'Fix login bug on mobile',
          description: 'GitHub Issue #15',
          provenance: { addedIn: 1, updatedIn: 2 },
        },
      ];

      const result = generateContextIndex(entries, 2);

      expect(result).toContain('## Updated in this iteration');
      expect(result).toContain(
        '**Fix login bug on mobile** (`github-issue-15.md`) - GitHub Issue #15, originally added in iteration 1'
      );
    });
  });

  describe('inherited entries', () => {
    it('should categorize entries from previous iterations as "From previous"', () => {
      const entries: IterationContextEntry[] = [
        {
          uri: 'file:./docs/auth.md',
          fetchedAt: '2024-01-15T10:30:00Z',
          file: 'local-auth-md.md',
          name: 'auth.md',
          description: 'Local file',
          provenance: { addedIn: 1 },
        },
      ];

      const result = generateContextIndex(entries, 3);

      expect(result).toContain('## From previous iterations');
      expect(result).toContain(
        '**auth.md** (`local-auth-md.md`) - added in iteration 1'
      );
    });
  });

  describe('mixed entries', () => {
    it('should correctly categorize a mix of new, updated, and inherited entries', () => {
      const entries: IterationContextEntry[] = [
        // New entry
        {
          uri: 'github:issue/22',
          fetchedAt: '2024-01-15T10:30:00Z',
          file: 'github-issue-22.md',
          name: 'Add user authentication',
          description: 'GitHub Issue #22',
          provenance: { addedIn: 2 },
        },
        // Updated entry
        {
          uri: 'github:issue/15',
          fetchedAt: '2024-01-15T10:30:00Z',
          file: 'github-issue-15.md',
          name: 'Fix login bug on mobile',
          description: 'GitHub Issue #15',
          provenance: { addedIn: 1, updatedIn: 2 },
        },
        // Inherited entry
        {
          uri: 'file:./docs/auth.md',
          fetchedAt: '2024-01-14T08:00:00Z',
          file: 'local-auth-md.md',
          name: 'auth.md',
          description: 'Local file',
          provenance: { addedIn: 1 },
        },
      ];

      const result = generateContextIndex(entries, 2);

      // Should have all three sections
      expect(result).toContain('## New in this iteration');
      expect(result).toContain('## Updated in this iteration');
      expect(result).toContain('## From previous iterations');

      // Verify entries are in correct sections
      const lines = result.split('\n');
      const newSectionIndex = lines.findIndex(l =>
        l.includes('## New in this iteration')
      );
      const updatedSectionIndex = lines.findIndex(l =>
        l.includes('## Updated in this iteration')
      );
      const fromPreviousSectionIndex = lines.findIndex(l =>
        l.includes('## From previous iterations')
      );

      // New entry should come after "New" heading
      const newEntryIndex = lines.findIndex(l =>
        l.includes('Add user authentication')
      );
      expect(newEntryIndex).toBeGreaterThan(newSectionIndex);
      expect(newEntryIndex).toBeLessThan(updatedSectionIndex);

      // Updated entry should come after "Updated" heading
      const updatedEntryIndex = lines.findIndex(l =>
        l.includes('Fix login bug on mobile')
      );
      expect(updatedEntryIndex).toBeGreaterThan(updatedSectionIndex);
      expect(updatedEntryIndex).toBeLessThan(fromPreviousSectionIndex);

      // Inherited entry should come after "From previous" heading
      const inheritedEntryIndex = lines.findIndex(l => l.includes('auth.md'));
      expect(inheritedEntryIndex).toBeGreaterThan(fromPreviousSectionIndex);
    });
  });

  describe('sources section', () => {
    it('should include detailed source information', () => {
      const entries: IterationContextEntry[] = [
        {
          uri: 'github:issue/22',
          fetchedAt: '2024-01-15T10:30:00Z',
          file: 'github-issue-22.md',
          name: 'Add user authentication',
          description: 'GitHub Issue #22',
          provenance: { addedIn: 2 },
          metadata: { type: 'github:issue' },
        },
      ];

      const result = generateContextIndex(entries, 2);

      expect(result).toContain('## Sources');
      expect(result).toContain('### Add user authentication');
      expect(result).toContain('- **File:** github-issue-22.md');
      expect(result).toContain('- **URI:** github:issue/22');
      expect(result).toContain('- **Type:** github:issue');
      expect(result).toContain('- **Fetched:** 2024-01-15T10:30:00Z');
      expect(result).toContain('- **Provenance:** added in iteration 2');
    });

    it('should format provenance for updated entries', () => {
      const entries: IterationContextEntry[] = [
        {
          uri: 'github:issue/15',
          fetchedAt: '2024-01-15T10:30:00Z',
          file: 'github-issue-15.md',
          name: 'Fix login bug',
          description: 'GitHub Issue #15',
          provenance: { addedIn: 1, updatedIn: 2 },
        },
      ];

      const result = generateContextIndex(entries, 2);

      expect(result).toContain(
        '- **Provenance:** added in iteration 1, updated in iteration 2'
      );
    });

    it('should omit Type field if metadata.type is not present', () => {
      const entries: IterationContextEntry[] = [
        {
          uri: 'custom://source',
          fetchedAt: '2024-01-15T10:30:00Z',
          file: 'custom.md',
          name: 'Custom Entry',
          description: 'No type metadata',
          provenance: { addedIn: 1 },
        },
      ];

      const result = generateContextIndex(entries, 1);

      expect(result).toContain('### Custom Entry');
      expect(result).toContain('- **File:** custom.md');
      expect(result).toContain('- **URI:** custom://source');
      expect(result).not.toContain('- **Type:**');
    });
  });

  describe('section ordering', () => {
    it('should only include sections that have entries', () => {
      // Only new entries
      const newOnly: IterationContextEntry[] = [
        {
          uri: 'github:issue/1',
          fetchedAt: '2024-01-15T10:30:00Z',
          file: 'issue-1.md',
          name: 'Issue 1',
          description: 'New issue',
          provenance: { addedIn: 1 },
        },
      ];

      const result = generateContextIndex(newOnly, 1);

      expect(result).toContain('## New in this iteration');
      expect(result).not.toContain('## Updated in this iteration');
      expect(result).not.toContain('## From previous iterations');
    });

    it('should not include empty sections', () => {
      // Only inherited entries
      const inheritedOnly: IterationContextEntry[] = [
        {
          uri: 'github:issue/1',
          fetchedAt: '2024-01-15T10:30:00Z',
          file: 'issue-1.md',
          name: 'Issue 1',
          description: 'Old issue',
          provenance: { addedIn: 1 },
        },
      ];

      const result = generateContextIndex(inheritedOnly, 3);

      expect(result).not.toContain('## New in this iteration');
      expect(result).not.toContain('## Updated in this iteration');
      expect(result).toContain('## From previous iterations');
    });
  });

  describe('formatting', () => {
    it('should use proper markdown formatting', () => {
      const entries: IterationContextEntry[] = [
        {
          uri: 'github:issue/1',
          fetchedAt: '2024-01-15T10:30:00Z',
          file: 'issue.md',
          name: 'Test Issue',
          description: 'Description',
          provenance: { addedIn: 1 },
        },
      ];

      const result = generateContextIndex(entries, 1);

      // Check for proper markdown header
      expect(result.startsWith('# Context for Iteration 1')).toBe(true);

      // Check for proper list formatting
      expect(result).toMatch(/^- \*\*Test Issue\*\*/m);

      // Check for proper code formatting for filenames
      expect(result).toContain('`issue.md`');
    });

    it('should handle special characters in names and descriptions', () => {
      const entries: IterationContextEntry[] = [
        {
          uri: 'github:issue/1',
          fetchedAt: '2024-01-15T10:30:00Z',
          file: 'issue.md',
          name: 'Fix `code` in **markdown**',
          description: 'Issue with <html> tags',
          provenance: { addedIn: 1 },
        },
      ];

      const result = generateContextIndex(entries, 1);

      // Names and descriptions are included as-is (no escaping)
      expect(result).toContain('Fix `code` in **markdown**');
      expect(result).toContain('Issue with <html> tags');
    });
  });
});
