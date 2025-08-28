import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PromptBuilder } from '../index.js';
import { IterationConfig } from '../../iteration.js';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';

describe('PromptBuilder', () => {
    let builder: PromptBuilder;
    let testIteration: IterationConfig;
    let tempDir: string;

    beforeEach(() => {
        builder = new PromptBuilder('claude');
        tempDir = mkdtempSync(join(tmpdir(), 'prompt-test-'));
        testIteration = IterationConfig.createInitial(
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

    describe('template loading', () => {
        it('should load and process context template', () => {
            const result = builder.context(testIteration);
            
            // Check that placeholders are replaced
            expect(result).toContain('Task title: Test Task Title');
            expect(result).toContain('Task description: Test task description with multiple lines');
            expect(result).not.toContain('%title%');
            expect(result).not.toContain('%description%');
            
            // Check that key sections are present
            expect(result).toContain('# Context');
            expect(result).toContain('## Task complexity');
            expect(result).toContain('## Relevant code');
            expect(result).toContain('## Extra OS packages');
        });

        it('should load and process plan template', () => {
            const result = builder.plan(testIteration);
            
            expect(result).toContain('Title: Test Task Title');
            expect(result).toContain('Test task description with multiple lines');
            expect(result).not.toContain('%title%');
            expect(result).not.toContain('%description%');
            
            expect(result).toContain('# Implementation Plan');
            expect(result).toContain('## Implementation Steps');
            expect(result).toContain('## Risks & Edge Cases');
        });

        it('should load and process implement template', () => {
            const result = builder.implement(testIteration);
            
            expect(result).toContain('Title: Test Task Title');
            expect(result).toContain('Test task description with multiple lines');
            expect(result).toContain('# Implementation Changes');
            expect(result).toContain('## Files Modified');
            expect(result).toContain('## Technical Details');
        });

        it('should load and process review template', () => {
            const result = builder.review(testIteration);
            
            expect(result).toContain('Title: Test Task Title');
            expect(result).toContain('Test task description with multiple lines');
            expect(result).toContain('# Code Review');
            expect(result).toContain('## Overall Assessment');
            expect(result).toContain('## Plan Adherence Issues');
        });

        it('should load and process apply_review template', () => {
            const result = builder.apply_review(testIteration);
            
            expect(result).toContain('Title: Test Task Title');
            expect(result).toContain('Test task description with multiple lines');
            expect(result).toContain('## Review Fixes Applied');
            expect(result).toContain('### Issues Addressed');
        });

        it('should load and process summary template', () => {
            const result = builder.summary(testIteration);
            
            expect(result).toContain('Title: Test Task Title');
            expect(result).toContain('Test task description with multiple lines');
            expect(result).toContain('# Implementation Summary');
            expect(result).toContain('## What was implemented');
            expect(result).toContain('## Files modified');
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
            
            expect(result).toContain('Brief Description: fix "quotes" & special <chars>');
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
            const result = builder.expandIterationInstructionsPrompt(instructions, previousPlan);
            
            expect(result).toContain('Previous iteration context:');
            expect(result).toContain('Previous Plan:');
            expect(result).toContain('Previous plan content');
            expect(result).toContain('add error handling');
        });

        it('should generate prompt with previous changes only', () => {
            const instructions = 'improve performance';
            const previousChanges = 'Previous changes made';
            const result = builder.expandIterationInstructionsPrompt(instructions, undefined, previousChanges);
            
            expect(result).toContain('Previous iteration context:');
            expect(result).toContain('Previous Changes Made:');
            expect(result).toContain('Previous changes made');
            expect(result).toContain('improve performance');
        });

        it('should generate prompt with both previous plan and changes', () => {
            const instructions = 'refactor code';
            const previousPlan = 'Plan: implement feature';
            const previousChanges = 'Changes: added new module';
            const result = builder.expandIterationInstructionsPrompt(instructions, previousPlan, previousChanges);
            
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
            expect(result).toContain('Task Description: Implement user login and signup');
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
            const summaries = ['Iteration 1: Added indexes', 'Iteration 2: Optimized joins'];
            
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
            const conflictedContent = '<<<<<<< HEAD\nold code\n=======\nnew code\n>>>>>>>';
            
            const result = builder.resolveMergeConflictsPrompt(
                filePath,
                diffContext,
                conflictedContent
            );
            
            expect(result).toContain('File: src/components/Header.tsx');
            expect(result).toContain('Recent commits: feat: update header, fix: styling');
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

    describe('generatePromptFiles', () => {
        it('should generate all prompt files in specified directory', () => {
            const promptsDir = join(tempDir, 'prompts');
            builder.generatePromptFiles(testIteration, promptsDir);
            
            // Check directory was created
            expect(existsSync(promptsDir)).toBe(true);
            
            // Check all expected files were created
            const expectedFiles = [
                'context.txt',
                'plan.txt', 
                'implement.txt',
                'review.txt',
                'apply_review.txt',
                'summary.txt'
            ];
            
            for (const file of expectedFiles) {
                const filePath = join(promptsDir, file);
                expect(existsSync(filePath)).toBe(true);
                
                // Check file content has placeholders replaced
                const content = readFileSync(filePath, 'utf8');
                expect(content).toContain('Test Task Title');
                expect(content).not.toContain('%title%');
                expect(content).not.toContain('%description%');
            }
        });

        it('should create nested directories if they do not exist', () => {
            const nestedDir = join(tempDir, 'deeply', 'nested', 'prompts');
            builder.generatePromptFiles(testIteration, nestedDir);
            
            expect(existsSync(nestedDir)).toBe(true);
            expect(existsSync(join(nestedDir, 'context.txt'))).toBe(true);
        });

        it('should overwrite existing files', () => {
            const promptsDir = join(tempDir, 'prompts');
            mkdirSync(promptsDir, { recursive: true });
            
            // Create a file with initial content
            const contextFile = join(promptsDir, 'context.txt');
            writeFileSync(contextFile, 'old content');
            
            // Generate prompt files
            builder.generatePromptFiles(testIteration, promptsDir);
            
            // Check file was overwritten
            const newContent = readFileSync(contextFile, 'utf8');
            expect(newContent).not.toContain('old content');
            expect(newContent).toContain('Test Task Title');
        });
    });

    describe('edge cases', () => {
        it('should handle minimal title and description', () => {
            // IterationConfig requires non-empty title and description
            const minimalIteration = IterationConfig.createInitial(tempDir, 1, ' ', ' ');
            const result = builder.context(minimalIteration);
            
            expect(result).toContain('Task title:  '); // Single space title
            expect(result).toContain('Task description:  '); // Single space description
        });

        it('should handle special characters in templates', () => {
            const specialIteration = IterationConfig.createInitial(
                tempDir,
                1,
                'Task with $special% characters',
                'Description with %placeholders% and $vars'
            );
            
            const result = builder.plan(specialIteration);
            expect(result).toContain('Task with $special% characters');
            expect(result).toContain('Description with %placeholders% and $vars');
        });

        it('should handle very long descriptions', () => {
            const longDescription = 'A'.repeat(10000);
            const longIteration = IterationConfig.createInitial(
                tempDir,
                1,
                'Long Task',
                longDescription
            );
            
            const result = builder.implement(longIteration);
            expect(result).toContain(longDescription);
        });

        it('should handle multiline descriptions correctly', () => {
            const multilineIteration = IterationConfig.createInitial(
                tempDir,
                1,
                'Multiline Task',
                'Line 1\nLine 2\n\nLine 4 with\ttabs'
            );
            
            const result = builder.summary(multilineIteration);
            expect(result).toContain('Line 1\nLine 2\n\nLine 4 with\ttabs');
        });
    });

    describe('IPromptTask interface', () => {
        it('should export IPromptTask interface', () => {
            // This is a compile-time check, but we can test usage
            const task: import('../index.js').IPromptTask = {
                title: 'Test Title',
                description: 'Test Description'
            };
            
            expect(task.title).toBe('Test Title');
            expect(task.description).toBe('Test Description');
        });
    });
});