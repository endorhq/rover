import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PromptBuilder } from '../index.js';
import { IterationManager } from 'rover-schemas';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';

describe('PromptBuilder', () => {
  let builder: PromptBuilder;
  let testIteration: IterationManager;
  let tempDir: string;

  beforeEach(() => {
    builder = new PromptBuilder('claude');
    tempDir = mkdtempSync(join(tmpdir(), 'prompt-test-'));
    testIteration = IterationManager.createInitial(
      tempDir,
      1,
      'Test Task Title',
      'Test task description with multiple lines\nand detailed information'
    );
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create instance with default agent', () => {
      const defaultBuilder = new PromptBuilder();
      expect(defaultBuilder.agent).toBe('claude');
    });

    it('should create instance with specified agent', () => {
      const geminiBuilder = new PromptBuilder('gemini');
      expect(geminiBuilder.agent).toBe('gemini');
    });
  });

  describe('expandTaskPrompt', () => {
    it('should generate correct prompt for task expansion', () => {
      const briefDescription = 'add user authentication';
      const result = builder.expandTaskPrompt(briefDescription);

      expect(result).toContain('Brief Description: add user authentication');
      expect(result).not.toContain('%briefDescription%');
      expect(result).toContain('Respond ONLY with valid JSON');
      expect(result).toContain('"title":');
      expect(result).toContain('"description":');

      // Check examples are included
      expect(result).toContain('add dark mode');
      expect(result).toContain('fix login bug');
    });

    it('should handle special characters in brief description', () => {
      const briefDescription = 'fix "quotes" & special <chars>';
      const result = builder.expandTaskPrompt(briefDescription);

      expect(result).toContain(
        'Brief Description: fix "quotes" & special <chars>'
      );
    });
  });

  describe('expandIterationInstructionsPrompt', () => {
    it('should generate prompt without previous context', () => {
      const instructions = 'add error handling';
      const result = builder.expandIterationInstructionsPrompt(instructions);

      expect(result).toContain('New user instructions for this iteration:');
      expect(result).toContain('add error handling');
      expect(result).not.toContain('Previous iteration context:');
      expect(result).not.toContain('%instructions%');
      expect(result).not.toContain('%contextSection%');
    });

    it('should generate prompt with previous plan only', () => {
      const instructions = 'add error handling';
      const previousPlan = 'Previous plan content';
      const result = builder.expandIterationInstructionsPrompt(
        instructions,
        previousPlan
      );

      expect(result).toContain('Previous iteration context:');
      expect(result).toContain('Previous Plan:');
      expect(result).toContain('Previous plan content');
      expect(result).toContain('add error handling');
    });

    it('should generate prompt with previous changes only', () => {
      const instructions = 'improve performance';
      const previousChanges = 'Previous changes made';
      const result = builder.expandIterationInstructionsPrompt(
        instructions,
        undefined,
        previousChanges
      );

      expect(result).toContain('Previous iteration context:');
      expect(result).toContain('Previous Changes Made:');
      expect(result).toContain('Previous changes made');
      expect(result).toContain('improve performance');
    });

    it('should generate prompt with both previous plan and changes', () => {
      const instructions = 'refactor code';
      const previousPlan = 'Plan: implement feature';
      const previousChanges = 'Changes: added new module';
      const result = builder.expandIterationInstructionsPrompt(
        instructions,
        previousPlan,
        previousChanges
      );

      expect(result).toContain('Previous iteration context:');
      expect(result).toContain('Previous Plan:');
      expect(result).toContain('Plan: implement feature');
      expect(result).toContain('Previous Changes Made:');
      expect(result).toContain('Changes: added new module');
      expect(result).toContain('refactor code');
    });
  });

  describe('generateCommitMessagePrompt', () => {
    it('should generate commit message prompt without summaries', () => {
      const taskTitle = 'Add authentication';
      const taskDescription = 'Implement user login and signup';
      const recentCommits = ['feat: add user profile', 'fix: resolve bug'];
      const summaries: string[] = [];

      const result = builder.generateCommitMessagePrompt(
        taskTitle,
        taskDescription,
        recentCommits,
        summaries
      );

      expect(result).toContain('Task Title: Add authentication');
      expect(result).toContain(
        'Task Description: Implement user login and signup'
      );
      expect(result).toContain('1. feat: add user profile');
      expect(result).toContain('2. fix: resolve bug');
      // When summaries is empty, only "Summary of the changes:" header appears, without actual summaries
      expect(result).toContain('Summary of the changes:');
      expect(result).not.toContain('Iteration'); // No iteration summaries should be present
      expect(result).toContain('Return ONLY the commit message text');
    });

    it('should generate commit message prompt with summaries', () => {
      const taskTitle = 'Refactor database';
      const taskDescription = 'Optimize database queries';
      const recentCommits = ['refactor: update queries'];
      const summaries = [
        'Iteration 1: Added indexes',
        'Iteration 2: Optimized joins',
      ];

      const result = builder.generateCommitMessagePrompt(
        taskTitle,
        taskDescription,
        recentCommits,
        summaries
      );

      expect(result).toContain('Task Title: Refactor database');
      expect(result).toContain('Task Description: Optimize database queries');
      expect(result).toContain('Summary of the changes:');
      expect(result).toContain('Iteration 1: Added indexes');
      expect(result).toContain('Iteration 2: Optimized joins');
      expect(result).toContain('1. refactor: update queries');
    });

    it('should handle empty recent commits array', () => {
      const result = builder.generateCommitMessagePrompt(
        'Task',
        'Description',
        [],
        []
      );

      expect(result).toContain('Commit examples:');
      expect(result).toContain('\n\n'); // Empty commits section
      expect(result).toContain('Return ONLY the commit message text');
    });
  });

  describe('resolveMergeConflictsPrompt', () => {
    it('should generate merge conflict resolution prompt', () => {
      const filePath = 'src/components/Header.tsx';
      const diffContext = 'Recent commits: feat: update header, fix: styling';
      const conflictedContent =
        '<<<<<<< HEAD\nold code\n=======\nnew code\n>>>>>>>';

      const result = builder.resolveMergeConflictsPrompt(
        filePath,
        diffContext,
        conflictedContent
      );

      expect(result).toContain('File: src/components/Header.tsx');
      expect(result).toContain(
        'Recent commits: feat: update header, fix: styling'
      );
      expect(result).toContain('<<<<<<< HEAD');
      expect(result).toContain('old code');
      expect(result).toContain('new code');
      expect(result).toContain('>>>>>>>');
      expect(result).toContain('All conflict markers');
      expect(result).toContain('removed');
      expect(result).toContain('Respond with ONLY the resolved file content');
    });

    it('should handle multiline conflicted content', () => {
      const filePath = 'test.js';
      const diffContext = 'context';
      const conflictedContent = `function test() {
<<<<<<< HEAD
    return 'version1';
=======
    return 'version2';
>>>>>>>
}`;

      const result = builder.resolveMergeConflictsPrompt(
        filePath,
        diffContext,
        conflictedContent
      );

      expect(result).toContain('File: test.js');
      expect(result).toContain(conflictedContent);
    });
  });

  describe('IPromptTask interface', () => {
    it('should export IPromptTask interface', () => {
      // This is a compile-time check, but we can test usage
      const task: import('../index.js').IPromptTask = {
        title: 'Test Title',
        description: 'Test Description',
      };

      expect(task.title).toBe('Test Title');
      expect(task.description).toBe('Test Description');
    });
  });
});
