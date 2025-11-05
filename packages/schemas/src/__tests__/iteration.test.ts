import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IterationManager } from '../iteration.js';
import { ITERATION_FILENAME } from '../iteration/schema.js';
import type { Iteration } from '../iteration/types.js';

describe('IterationManager', () => {
  let testDir: string;
  let iterationPath: string;
  let iterationFilePath: string;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'rover-iteration-test-'));
    iterationPath = testDir;
    iterationFilePath = join(iterationPath, ITERATION_FILENAME);
  });

  afterEach(() => {
    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('createInitial()', () => {
    it('should create a new iteration config for the first iteration', () => {
      const iteration = IterationManager.createInitial(
        iterationPath,
        1,
        'First Task',
        'This is the first task description'
      );

      expect(iteration.id).toBe(1);
      expect(iteration.iteration).toBe(1);
      expect(iteration.title).toBe('First Task');
      expect(iteration.description).toBe('This is the first task description');
      expect(iteration.version).toBeDefined();
      expect(iteration.createdAt).toBeDefined();
      expect(iteration.previousContext).toEqual({});
      expect(existsSync(iterationFilePath)).toBe(true);
    });

    it('should persist iteration data to disk', () => {
      IterationManager.createInitial(
        iterationPath,
        42,
        'Test Task',
        'Test description'
      );

      // Read file directly and verify content
      const fileContent = JSON.parse(readFileSync(iterationFilePath, 'utf8'));
      expect(fileContent.id).toBe(42);
      expect(fileContent.iteration).toBe(1);
      expect(fileContent.title).toBe('Test Task');
      expect(fileContent.description).toBe('Test description');
      expect(fileContent.previousContext).toEqual({});
    });

    it('should set createdAt timestamp to ISO format', () => {
      const iteration = IterationManager.createInitial(
        iterationPath,
        1,
        'Task',
        'Description'
      );

      // Verify timestamp is valid ISO string
      expect(() => new Date(iteration.createdAt)).not.toThrow();
      expect(iteration.createdAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );
    });

    it('should have empty previousContext for first iteration', () => {
      const iteration = IterationManager.createInitial(
        iterationPath,
        1,
        'Task',
        'Description'
      );

      expect(iteration.previousContext).toEqual({});
      expect(Object.keys(iteration.previousContext)).toHaveLength(0);
    });
  });

  describe('createIteration()', () => {
    it('should create a new iteration config for subsequent iterations', () => {
      const previousContext = {
        plan: 'Previous plan details',
        summary: 'Previous iteration summary',
        iterationNumber: 1,
      };

      const iteration = IterationManager.createIteration(
        iterationPath,
        2,
        10,
        'Second Iteration',
        'Continue working on the task',
        previousContext
      );

      expect(iteration.id).toBe(10);
      expect(iteration.iteration).toBe(2);
      expect(iteration.title).toBe('Second Iteration');
      expect(iteration.description).toBe('Continue working on the task');
      expect(iteration.previousContext).toEqual(previousContext);
      expect(existsSync(iterationFilePath)).toBe(true);
    });

    it('should persist previousContext to disk', () => {
      const previousContext = {
        plan: 'Step 1: Do something\nStep 2: Do another thing',
        summary: 'Completed initial setup and configuration',
        iterationNumber: 5,
      };

      IterationManager.createIteration(
        iterationPath,
        6,
        100,
        'Iteration 6',
        'Next steps',
        previousContext
      );

      // Read file directly and verify content
      const fileContent = JSON.parse(readFileSync(iterationFilePath, 'utf8'));
      expect(fileContent.previousContext).toEqual(previousContext);
      expect(fileContent.previousContext.plan).toBe(previousContext.plan);
      expect(fileContent.previousContext.summary).toBe(previousContext.summary);
      expect(fileContent.previousContext.iterationNumber).toBe(5);
    });

    it('should handle partial previousContext', () => {
      const iteration = IterationManager.createIteration(
        iterationPath,
        3,
        20,
        'Task',
        'Description',
        { summary: 'Only summary provided' }
      );

      expect(iteration.previousContext).toEqual({
        summary: 'Only summary provided',
      });
      expect(iteration.previousContext.plan).toBeUndefined();
      expect(iteration.previousContext.iterationNumber).toBeUndefined();
    });

    it('should handle empty previousContext', () => {
      const iteration = IterationManager.createIteration(
        iterationPath,
        2,
        10,
        'Task',
        'Description',
        {}
      );

      expect(iteration.previousContext).toEqual({});
    });
  });

  describe('load()', () => {
    it('should load an existing iteration config from disk', () => {
      // Create an iteration first
      const created = IterationManager.createInitial(
        iterationPath,
        123,
        'Original Task',
        'Original description'
      );

      // Load it
      const loaded = IterationManager.load(iterationPath);

      expect(loaded.id).toBe(created.id);
      expect(loaded.iteration).toBe(created.iteration);
      expect(loaded.title).toBe(created.title);
      expect(loaded.description).toBe(created.description);
      expect(loaded.createdAt).toBe(created.createdAt);
    });

    it('should throw error when file does not exist', () => {
      const nonExistentPath = join(testDir, 'non-existent-dir');

      expect(() => {
        IterationManager.load(nonExistentPath);
      }).toThrow('Iteration config not found');
    });

    it('should throw error for invalid JSON', () => {
      writeFileSync(iterationFilePath, 'invalid json{', 'utf8');

      expect(() => {
        IterationManager.load(iterationPath);
      }).toThrow('Invalid JSON in iteration config');
    });

    it('should preserve all fields when loading', () => {
      const previousContext = {
        plan: 'Test plan',
        summary: 'Test summary',
        iterationNumber: 2,
      };

      const created = IterationManager.createIteration(
        iterationPath,
        3,
        50,
        'Task Title',
        'Task Description',
        previousContext
      );

      const loaded = IterationManager.load(iterationPath);

      expect(loaded.id).toBe(created.id);
      expect(loaded.iteration).toBe(created.iteration);
      expect(loaded.title).toBe(created.title);
      expect(loaded.description).toBe(created.description);
      expect(loaded.createdAt).toBe(created.createdAt);
      expect(loaded.previousContext).toEqual(previousContext);
    });
  });

  describe('exists()', () => {
    it('should return true when iteration config exists', () => {
      IterationManager.createInitial(iterationPath, 1, 'Task', 'Description');

      expect(IterationManager.exists(iterationPath)).toBe(true);
    });

    it('should return false when iteration config does not exist', () => {
      expect(IterationManager.exists(iterationPath)).toBe(false);
    });

    it('should return false for non-existent directory', () => {
      const nonExistentPath = join(testDir, 'non-existent-dir');

      expect(IterationManager.exists(nonExistentPath)).toBe(false);
    });
  });

  describe('save()', () => {
    it('should save iteration data to disk', () => {
      const iteration = IterationManager.createInitial(
        iterationPath,
        1,
        'Task',
        'Description'
      );

      // Verify file exists
      expect(existsSync(iterationFilePath)).toBe(true);

      // Load and verify
      const loaded = IterationManager.load(iterationPath);
      expect(loaded.id).toBe(1);
      expect(loaded.title).toBe('Task');
    });

    it('should overwrite existing file when saving', () => {
      const iteration = IterationManager.createInitial(
        iterationPath,
        1,
        'Original',
        'Original description'
      );

      // Manually modify and save
      const data = JSON.parse(readFileSync(iterationFilePath, 'utf8'));
      data.title = 'Modified';
      writeFileSync(iterationFilePath, JSON.stringify(data, null, 2), 'utf8');

      const loaded = IterationManager.load(iterationPath);
      expect(loaded.title).toBe('Modified');
    });
  });

  describe('validation', () => {
    it('should validate required fields', () => {
      const invalidData = {
        version: '1.0',
        iteration: 1,
        // missing id, title, description
        createdAt: new Date().toISOString(),
        previousContext: {},
      };

      writeFileSync(iterationFilePath, JSON.stringify(invalidData), 'utf8');

      expect(() => {
        IterationManager.load(iterationPath);
      }).toThrow();
    });

    it('should validate iteration number is positive', () => {
      const invalidData = {
        version: '1.0',
        id: 1,
        iteration: 0,
        title: 'Task',
        description: 'Description',
        createdAt: new Date().toISOString(),
        previousContext: {},
      };

      writeFileSync(iterationFilePath, JSON.stringify(invalidData), 'utf8');

      expect(() => {
        IterationManager.load(iterationPath);
      }).toThrow();
    });

    it('should allow id of 0 (no minimum constraint)', () => {
      const validData = {
        version: '1.0',
        id: 0,
        iteration: 1,
        title: 'Task',
        description: 'Description',
        createdAt: new Date().toISOString(),
        previousContext: {},
      };

      writeFileSync(iterationFilePath, JSON.stringify(validData), 'utf8');

      const loaded = IterationManager.load(iterationPath);
      expect(loaded.id).toBe(0);
    });
  });

  describe('getter properties', () => {
    it('should provide access to iteration properties via getters', () => {
      const previousContext = {
        plan: 'Test plan',
        summary: 'Test summary',
        iterationNumber: 1,
      };

      const iteration = IterationManager.createIteration(
        iterationPath,
        2,
        100,
        'Test Task',
        'Test Description',
        previousContext
      );

      expect(iteration.version).toBeDefined();
      expect(iteration.id).toBe(100);
      expect(iteration.iteration).toBe(2);
      expect(iteration.title).toBe('Test Task');
      expect(iteration.description).toBe('Test Description');
      expect(iteration.createdAt).toBeDefined();
      expect(iteration.previousContext).toEqual(previousContext);
    });
  });

  describe('toJSON()', () => {
    it('should return a copy of iteration data', () => {
      const iteration = IterationManager.createInitial(
        iterationPath,
        1,
        'Task',
        'Description'
      );

      const json = iteration.toJSON();

      expect(json.id).toBe(1);
      expect(json.iteration).toBe(1);
      expect(json.title).toBe('Task');
      expect(json.description).toBe('Description');
      expect(json.previousContext).toEqual({});
    });

    it('should return a new object each time', () => {
      const iteration = IterationManager.createInitial(
        iterationPath,
        1,
        'Task',
        'Description'
      );

      const json1 = iteration.toJSON();
      const json2 = iteration.toJSON();

      expect(json1).not.toBe(json2);
      expect(json1).toEqual(json2);
    });

    it('should not affect original data when modified', () => {
      const iteration = IterationManager.createInitial(
        iterationPath,
        1,
        'Original',
        'Description'
      );

      const json = iteration.toJSON();
      json.title = 'Modified';

      expect(iteration.title).toBe('Original');
    });
  });

  describe('getMarkdownFiles()', () => {
    it('should return empty map when no markdown files exist', () => {
      const iteration = IterationManager.createInitial(
        iterationPath,
        1,
        'Task',
        'Description'
      );

      const files = iteration.getMarkdownFiles();

      expect(files.size).toBe(0);
    });

    it('should return all markdown files in iteration directory', () => {
      IterationManager.createInitial(iterationPath, 1, 'Task', 'Description');

      // Create some markdown files
      writeFileSync(join(iterationPath, 'notes.md'), '# Notes', 'utf8');
      writeFileSync(join(iterationPath, 'plan.md'), '# Plan', 'utf8');
      writeFileSync(join(iterationPath, 'summary.md'), '# Summary', 'utf8');

      const iteration = IterationManager.load(iterationPath);
      const files = iteration.getMarkdownFiles();

      expect(files.size).toBe(3);
      expect(files.has('notes.md')).toBe(true);
      expect(files.has('plan.md')).toBe(true);
      expect(files.has('summary.md')).toBe(true);
      expect(files.get('notes.md')).toBe('# Notes');
      expect(files.get('plan.md')).toBe('# Plan');
      expect(files.get('summary.md')).toBe('# Summary');
    });

    it('should only return markdown files, not other files', () => {
      IterationManager.createInitial(iterationPath, 1, 'Task', 'Description');

      // Create markdown and non-markdown files
      writeFileSync(join(iterationPath, 'notes.md'), '# Notes', 'utf8');
      writeFileSync(join(iterationPath, 'data.json'), '{}', 'utf8');
      writeFileSync(join(iterationPath, 'script.ts'), 'console.log()', 'utf8');

      const iteration = IterationManager.load(iterationPath);
      const files = iteration.getMarkdownFiles();

      expect(files.size).toBe(1);
      expect(files.has('notes.md')).toBe(true);
      expect(files.has('data.json')).toBe(false);
      expect(files.has('script.ts')).toBe(false);
    });

    it('should return requested files only', () => {
      IterationManager.createInitial(iterationPath, 1, 'Task', 'Description');

      writeFileSync(join(iterationPath, 'notes.md'), '# Notes', 'utf8');
      writeFileSync(join(iterationPath, 'plan.md'), '# Plan', 'utf8');
      writeFileSync(join(iterationPath, 'summary.md'), '# Summary', 'utf8');

      const iteration = IterationManager.load(iterationPath);
      const files = iteration.getMarkdownFiles(['notes.md', 'plan.md']);

      expect(files.size).toBe(2);
      expect(files.has('notes.md')).toBe(true);
      expect(files.has('plan.md')).toBe(true);
      expect(files.has('summary.md')).toBe(false);
    });

    it('should ignore requested files that do not exist', () => {
      IterationManager.createInitial(iterationPath, 1, 'Task', 'Description');

      writeFileSync(join(iterationPath, 'notes.md'), '# Notes', 'utf8');

      const iteration = IterationManager.load(iterationPath);
      const files = iteration.getMarkdownFiles(['notes.md', 'non-existent.md']);

      expect(files.size).toBe(1);
      expect(files.has('notes.md')).toBe(true);
      expect(files.has('non-existent.md')).toBe(false);
    });

    it('should handle markdown files with unicode content', () => {
      IterationManager.createInitial(iterationPath, 1, 'Task', 'Description');

      writeFileSync(
        join(iterationPath, 'unicode.md'),
        '# 测试 🚀\n\n进行中',
        'utf8'
      );

      const iteration = IterationManager.load(iterationPath);
      const files = iteration.getMarkdownFiles();

      expect(files.get('unicode.md')).toBe('# 测试 🚀\n\n进行中');
    });

    it('should return files in sorted order', () => {
      IterationManager.createInitial(iterationPath, 1, 'Task', 'Description');

      writeFileSync(join(iterationPath, 'zebra.md'), 'Z', 'utf8');
      writeFileSync(join(iterationPath, 'alpha.md'), 'A', 'utf8');
      writeFileSync(join(iterationPath, 'beta.md'), 'B', 'utf8');

      const iteration = IterationManager.load(iterationPath);
      const files = iteration.getMarkdownFiles();
      const fileNames = Array.from(files.keys());

      expect(fileNames).toEqual(['alpha.md', 'beta.md', 'zebra.md']);
    });
  });

  describe('listMarkdownFiles()', () => {
    it('should return empty array when no markdown files exist', () => {
      const iteration = IterationManager.createInitial(
        iterationPath,
        1,
        'Task',
        'Description'
      );

      const files = iteration.listMarkdownFiles();

      expect(files).toEqual([]);
    });

    it('should return list of markdown filenames', () => {
      IterationManager.createInitial(iterationPath, 1, 'Task', 'Description');

      writeFileSync(join(iterationPath, 'notes.md'), '# Notes', 'utf8');
      writeFileSync(join(iterationPath, 'plan.md'), '# Plan', 'utf8');

      const iteration = IterationManager.load(iterationPath);
      const files = iteration.listMarkdownFiles();

      expect(files).toEqual(['notes.md', 'plan.md']);
    });

    it('should only list markdown files', () => {
      IterationManager.createInitial(iterationPath, 1, 'Task', 'Description');

      writeFileSync(join(iterationPath, 'notes.md'), '# Notes', 'utf8');
      writeFileSync(join(iterationPath, 'data.json'), '{}', 'utf8');

      const iteration = IterationManager.load(iterationPath);
      const files = iteration.listMarkdownFiles();

      expect(files).toEqual(['notes.md']);
    });

    it('should return files in sorted order', () => {
      IterationManager.createInitial(iterationPath, 1, 'Task', 'Description');

      writeFileSync(join(iterationPath, 'zebra.md'), 'Z', 'utf8');
      writeFileSync(join(iterationPath, 'alpha.md'), 'A', 'utf8');

      const iteration = IterationManager.load(iterationPath);
      const files = iteration.listMarkdownFiles();

      expect(files).toEqual(['alpha.md', 'zebra.md']);
    });

    it('should return empty array when directory does not exist', () => {
      const iteration = IterationManager.createInitial(
        iterationPath,
        1,
        'Task',
        'Description'
      );

      // Remove the directory
      rmSync(iterationPath, { recursive: true, force: true });

      const files = iteration.listMarkdownFiles();

      expect(files).toEqual([]);
    });
  });

  describe('status()', () => {
    it('should throw error when status.json does not exist', () => {
      const iteration = IterationManager.createInitial(
        iterationPath,
        1,
        'Task',
        'Description'
      );

      expect(() => {
        iteration.status();
      }).toThrow('The status.json file is missing for this iteration');
    });

    it('should load status when status.json exists', () => {
      IterationManager.createInitial(iterationPath, 1, 'Task', 'Description');

      // Create a status.json file
      const statusData = {
        taskId: 'task-1',
        status: 'running',
        currentStep: 'Processing',
        progress: 50,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(
        join(iterationPath, 'status.json'),
        JSON.stringify(statusData, null, 2),
        'utf8'
      );

      const iteration = IterationManager.load(iterationPath);
      const status = iteration.status();

      expect(status.taskId).toBe('task-1');
      expect(status.status).toBe('running');
      expect(status.progress).toBe(50);
    });

    it('should cache status after first load', () => {
      IterationManager.createInitial(iterationPath, 1, 'Task', 'Description');

      const statusData = {
        taskId: 'task-1',
        status: 'running',
        currentStep: 'Processing',
        progress: 50,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      writeFileSync(
        join(iterationPath, 'status.json'),
        JSON.stringify(statusData, null, 2),
        'utf8'
      );

      const iteration = IterationManager.load(iterationPath);
      const status1 = iteration.status();
      const status2 = iteration.status();

      // Should return the same instance (cached)
      expect(status1).toBe(status2);
    });

    it('should throw error when status.json has invalid format', () => {
      IterationManager.createInitial(iterationPath, 1, 'Task', 'Description');

      writeFileSync(
        join(iterationPath, 'status.json'),
        'invalid json{',
        'utf8'
      );

      const iteration = IterationManager.load(iterationPath);

      expect(() => {
        iteration.status();
      }).toThrow('There was an error loading the status.json file');
    });
  });

  describe('migrate()', () => {
    it('should return data as-is when already current version', () => {
      const iteration = IterationManager.createInitial(
        iterationPath,
        1,
        'Task',
        'Description'
      );

      const fileContent = readFileSync(iterationFilePath, 'utf8');
      const originalData = JSON.parse(fileContent);

      // Load again - should not trigger migration
      const loaded = IterationManager.load(iterationPath);

      const reloadedContent = readFileSync(iterationFilePath, 'utf8');
      const reloadedData = JSON.parse(reloadedContent);

      expect(reloadedData.version).toBe(originalData.version);
    });

    it('should handle data without version field by adding it', () => {
      const dataWithoutVersion = {
        id: 1,
        iteration: 1,
        title: 'Task',
        description: 'Description',
        createdAt: new Date().toISOString(),
        previousContext: {},
      };

      writeFileSync(
        iterationFilePath,
        JSON.stringify(dataWithoutVersion),
        'utf8'
      );

      // Migration should add version field
      const loaded = IterationManager.load(iterationPath);
      expect(loaded.version).toBe('1.0');

      // Verify it was saved with the version
      const savedData = JSON.parse(readFileSync(iterationFilePath, 'utf8'));
      expect(savedData.version).toBe('1.0');
    });
  });

  describe('edge cases', () => {
    it('should reject empty strings in title and description', () => {
      const data = {
        version: '1.0',
        id: 1,
        iteration: 1,
        title: '',
        description: '',
        createdAt: new Date().toISOString(),
        previousContext: {},
      };

      writeFileSync(iterationFilePath, JSON.stringify(data), 'utf8');

      expect(() => {
        IterationManager.load(iterationPath);
      }).toThrow('Title is required');
    });

    it('should handle very long strings', () => {
      const longString = 'a'.repeat(10000);
      const iteration = IterationManager.createInitial(
        iterationPath,
        1,
        longString,
        longString
      );

      expect(iteration.title).toBe(longString);
      expect(iteration.description).toBe(longString);

      // Verify persistence
      const loaded = IterationManager.load(iterationPath);
      expect(loaded.title).toBe(longString);
      expect(loaded.description).toBe(longString);
    });

    it('should handle unicode characters', () => {
      const iteration = IterationManager.createInitial(
        iterationPath,
        1,
        '测试任务 🚀',
        'Description with émojis 💻 and spëcial çhars'
      );

      expect(iteration.title).toBe('测试任务 🚀');
      expect(iteration.description).toBe(
        'Description with émojis 💻 and spëcial çhars'
      );

      // Verify persistence
      const loaded = IterationManager.load(iterationPath);
      expect(loaded.title).toBe('测试任务 🚀');
    });

    it('should handle large iteration numbers', () => {
      const iteration = IterationManager.createIteration(
        iterationPath,
        999999,
        1,
        'Task',
        'Description',
        { iterationNumber: 999998 }
      );

      expect(iteration.iteration).toBe(999999);
      expect(iteration.previousContext.iterationNumber).toBe(999998);
    });

    it('should handle previousContext with multiline strings', () => {
      const multilinePlan = `Step 1: Initialize
Step 2: Process data
Step 3: Validate results
Step 4: Complete`;

      const iteration = IterationManager.createIteration(
        iterationPath,
        2,
        1,
        'Task',
        'Description',
        { plan: multilinePlan }
      );

      expect(iteration.previousContext.plan).toBe(multilinePlan);

      // Verify persistence
      const loaded = IterationManager.load(iterationPath);
      expect(loaded.previousContext.plan).toBe(multilinePlan);
    });

    it('should handle directory that exists but is empty', () => {
      const iteration = IterationManager.createInitial(
        iterationPath,
        1,
        'Task',
        'Description'
      );

      const files = iteration.listMarkdownFiles();
      expect(files).toEqual([]);
    });

    it('should not include subdirectories in markdown file list', () => {
      IterationManager.createInitial(iterationPath, 1, 'Task', 'Description');

      writeFileSync(join(iterationPath, 'file.md'), 'content', 'utf8');

      // Create a subdirectory with a markdown file
      const subDir = mkdtempSync(join(iterationPath, 'subdir-'));
      writeFileSync(join(subDir, 'nested.md'), 'nested content', 'utf8');

      const iteration = IterationManager.load(iterationPath);
      const files = iteration.listMarkdownFiles();

      expect(files).toEqual(['file.md']);
      expect(files.includes('nested.md')).toBe(false);
    });
  });
});
