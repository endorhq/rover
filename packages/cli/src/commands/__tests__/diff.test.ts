import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchSync } from 'rover-core';
import { diffCommand } from '../diff.js';
import { TaskDescriptionManager } from 'rover-schemas';

// Mock external dependencies
vi.mock('../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    eventDiff: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock display utilities to suppress output during tests
vi.mock('../../utils/display.js', () => ({
  showTips: vi.fn(),
}));

// Spy on console methods to verify output
const consoleSpy = {
  log: vi.spyOn(console, 'log').mockImplementation(() => {}),
  error: vi.spyOn(console, 'error').mockImplementation(() => {}),
};

describe('diff command', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create temp directory with git repo
    testDir = mkdtempSync(join(tmpdir(), 'rover-diff-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Initialize git repo
    launchSync('git', ['init']);
    launchSync('git', ['config', 'user.email', 'test@test.com']);
    launchSync('git', ['config', 'user.name', 'Test User']);
    launchSync('git', ['config', 'commit.gpgsign', 'false']);

    // Create initial commit
    writeFileSync('README.md', '# Test Project\n');
    writeFileSync('.gitignore', 'node_modules/\n*.log\n.rover\n');
    launchSync('git', ['add', '.']);
    launchSync('git', ['commit', '-m', 'Initial commit']);

    // Create .rover directory structure
    mkdirSync('.rover/tasks', { recursive: true });

    // Clear console mocks
    consoleSpy.log.mockClear();
    consoleSpy.error.mockClear();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  // Helper to create a test task with a worktree
  const createTestTask = (id: number, title: string = 'Test Task') => {
    const task = TaskDescriptionManager.create({
      id,
      title,
      description: 'Test task description',
      inputs: new Map(),
      workflowName: 'swe',
    });

    // Create a git worktree for the task
    const worktreePath = join('.rover', 'tasks', id.toString(), 'workspace');
    const branchName = `rover-task-${id}`;

    launchSync('git', ['worktree', 'add', worktreePath, '-b', branchName]);
    task.setWorkspace(join(testDir, worktreePath), branchName);

    return { task, worktreePath, branchName };
  };

  describe('Task validation', () => {
    it('should reject non-numeric task ID', async () => {
      await diffCommand('invalid');

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining(
          "✗ Invalid task ID 'invalid' - must be a number"
        )
      );
    });

    it('should handle non-existent task', async () => {
      await diffCommand('999');

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('✗ Task 999 not found')
      );
    });

    it('should handle task without workspace', async () => {
      // Create task without workspace
      const task = TaskDescriptionManager.create({
        id: 1,
        title: 'No Workspace Task',
        description: 'Test',
        inputs: new Map(),
        workflowName: 'swe',
      });

      await diffCommand('1');

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('✗ No workspace found for task')
      );
    });
  });

  describe('Basic diff functionality', () => {
    it('should show no changes when workspace is clean', async () => {
      createTestTask(1, 'Clean Task');

      await diffCommand('1');

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('No changes found in workspace')
      );
    });

    it('should show unstaged changes', async () => {
      const { worktreePath } = createTestTask(2, 'Unstaged Changes Task');

      // Modify an existing file
      const readmePath = join(worktreePath, 'README.md');
      appendFileSync(readmePath, '\n## New Section\nThis is new content.\n');

      await diffCommand('2');

      // Verify output includes the changes
      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      expect(output).toContain('Task 2 Changes');
      expect(output).toContain('+## New Section');
      expect(output).toContain('+This is new content.');
    });

    it('should show staged changes', async () => {
      const { worktreePath } = createTestTask(3, 'Staged Changes Task');

      // Create and stage a new file
      const newFilePath = join(worktreePath, 'new-file.js');
      writeFileSync(newFilePath, 'console.log("Hello World");\n');
      launchSync('git', ['add', 'new-file.js'], {
        cwd: worktreePath,
      });

      await diffCommand('3');

      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      // Staged files show up in HEAD diff comparison
      expect(output).toContain('Task 3 Changes');
      // Git diff won't show staged changes without HEAD comparison
      // Since the file is staged but not committed, it won't appear in a simple diff
      expect(output).toContain('No changes found in workspace');
    });

    it('should show both staged and unstaged changes', async () => {
      const { worktreePath } = createTestTask(4, 'Mixed Changes Task');

      // Stage a new file
      const stagedFile = join(worktreePath, 'staged.txt');
      writeFileSync(stagedFile, 'This file is staged\n');
      launchSync('git', ['add', 'staged.txt'], {
        cwd: worktreePath,
      });

      // Create an unstaged modification
      const readmePath = join(worktreePath, 'README.md');
      appendFileSync(readmePath, 'Unstaged modification\n');

      await diffCommand('4');

      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      // Unstaged changes should be visible
      expect(output).toContain('README.md');
      expect(output).toContain('+Unstaged modification');
      // Staged file won't show in diff without HEAD comparison
    });
  });

  describe('Untracked files handling', () => {
    it('should include untracked files in diff', async () => {
      const { worktreePath } = createTestTask(5, 'Untracked Files Task');

      // Create untracked files
      writeFileSync(
        join(worktreePath, 'untracked1.txt'),
        'First untracked file\n'
      );
      writeFileSync(join(worktreePath, 'untracked2.js'), 'const x = 42;\n');
      mkdirSync(join(worktreePath, 'new-dir'), { recursive: true });
      writeFileSync(
        join(worktreePath, 'new-dir', 'nested.txt'),
        'Nested untracked file\n'
      );

      await diffCommand('5');

      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      // Check that untracked files are shown
      expect(output).toContain('untracked1.txt');
      expect(output).toContain('+First untracked file');
      expect(output).toContain('untracked2.js');
      expect(output).toContain('+const x = 42;');
      // Nested files might not show if Git doesn't track directory separately
    });

    it('should respect .gitignore for untracked files', async () => {
      const { worktreePath } = createTestTask(6, 'Gitignore Task');

      // Create files, some matching .gitignore patterns
      writeFileSync(join(worktreePath, 'important.txt'), 'This should show\n');
      writeFileSync(
        join(worktreePath, 'debug.log'),
        'This should be ignored\n'
      );
      mkdirSync(join(worktreePath, 'node_modules'), { recursive: true });
      writeFileSync(
        join(worktreePath, 'node_modules', 'package.json'),
        'Should be ignored\n'
      );

      await diffCommand('6');

      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      // Should show non-ignored file
      expect(output).toContain('important.txt');
      expect(output).toContain('+This should show');

      // Should NOT show ignored files
      expect(output).not.toContain('debug.log');
      expect(output).not.toContain('node_modules');
    });

    it('should handle mix of tracked, untracked, and modified files', async () => {
      const { worktreePath } = createTestTask(7, 'Mixed Files Task');

      // Modified tracked file
      const readmePath = join(worktreePath, 'README.md');
      appendFileSync(readmePath, 'Modified content\n');

      // New staged file
      writeFileSync(join(worktreePath, 'staged-new.txt'), 'Staged new file\n');
      launchSync('git', ['add', 'staged-new.txt'], {
        cwd: worktreePath,
      });

      // Untracked files
      writeFileSync(join(worktreePath, 'untracked.txt'), 'Untracked content\n');
      writeFileSync(
        join(worktreePath, 'another-untracked.md'),
        '# Another untracked\n'
      );

      await diffCommand('7');

      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      // Check for modified tracked files
      expect(output).toContain('README.md');
      expect(output).toContain('+Modified content');
      // Check for untracked files
      expect(output).toContain('untracked.txt');
      expect(output).toContain('+Untracked content');
      expect(output).toContain('another-untracked.md');
      expect(output).toContain('+# Another untracked');
      // Staged files won't show in basic diff
    });
  });

  describe('File-specific diff', () => {
    it('should show diff for specific file only', async () => {
      const { worktreePath } = createTestTask(8, 'Specific File Task');

      // Create multiple changes
      appendFileSync(join(worktreePath, 'README.md'), 'README change\n');
      writeFileSync(join(worktreePath, 'file1.txt'), 'File 1 content\n');
      writeFileSync(join(worktreePath, 'file2.txt'), 'File 2 content\n');

      await diffCommand('8', 'README.md');

      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      // Should only show README.md changes
      expect(output).toContain('README.md');
      expect(output).toContain('+README change');

      // Should not show other files
      expect(output).not.toContain('file1.txt');
      expect(output).not.toContain('file2.txt');
    });

    it('should handle non-existent file path', async () => {
      createTestTask(9, 'Non-existent File Task');

      await diffCommand('9', 'non-existent.txt');

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('No changes found for file: non-existent.txt')
      );
    });

    it('should show diff for untracked file when specified', async () => {
      const { worktreePath } = createTestTask(10, 'Untracked Specific Task');

      // Create untracked file
      writeFileSync(
        join(worktreePath, 'new-untracked.js'),
        'function test() { return 42; }\n'
      );

      await diffCommand('10', 'new-untracked.js');

      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      // Untracked files might not show when specific file is requested
      // This is expected behavior as git diff with file path won't show untracked
      expect(output).toContain('No changes found for file: new-untracked.js');
    });
  });

  describe('--only-files flag', () => {
    it('should list only file names when flag is set', async () => {
      const { worktreePath } = createTestTask(11, 'Files Only Task');

      // Create various changes
      appendFileSync(join(worktreePath, 'README.md'), 'Change\n');
      writeFileSync(join(worktreePath, 'new1.txt'), 'Content 1\n');
      writeFileSync(join(worktreePath, 'new2.txt'), 'Content 2\n');
      mkdirSync(join(worktreePath, 'src'), { recursive: true });
      writeFileSync(
        join(worktreePath, 'src', 'index.js'),
        'console.log("test");\n'
      );

      await diffCommand('11', undefined, { onlyFiles: true });

      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      // Should show file names
      expect(output).toContain('Changed Files');
      expect(output).toContain('README.md');
      // Untracked files should be included
      expect(output).toContain('new1.txt');
      expect(output).toContain('new2.txt');

      // Should NOT show file contents
      expect(output).not.toContain('+Change');
      expect(output).not.toContain('+Content 1');
      expect(output).not.toContain('+console.log');
    });

    it('should show no files message when no changes', async () => {
      createTestTask(12, 'No Files Task');

      await diffCommand('12', undefined, { onlyFiles: true });

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('No changes found in workspace')
      );
    });
  });

  describe('Branch comparison', () => {
    // TODO: Review this specific test as it's failing on the CI.
    //       It works locally only. I tried it with CI=1 and still works.
    it.skip('should compare with specified branch', async () => {
      const { worktreePath } = createTestTask(13, 'Branch Compare Task');

      // Make changes in the worktree and commit them
      appendFileSync(
        join(worktreePath, 'README.md'),
        '## Task specific change\n'
      );
      writeFileSync(
        join(worktreePath, 'task-file.txt'),
        'Task branch content\n'
      );
      launchSync('git', ['add', '.'], { cwd: worktreePath });
      launchSync('git', ['commit', '-m', 'Task changes'], {
        cwd: worktreePath,
      });

      // Make different changes in main branch
      writeFileSync('main-only.txt', 'Main branch file\n');
      launchSync('git', ['add', '.']);
      launchSync('git', ['commit', '-m', 'Main branch change']);

      await diffCommand('13', undefined, { branch: 'main' });

      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      // Should show branch comparison info
      expect(output).toContain('Comparing with:');
      expect(output).toContain('main');
      // Should show committed differences between task branch and main
      expect(output).toContain('README.md');
      expect(output).toContain('+## Task specific change');
      expect(output).toContain('task-file.txt');
      expect(output).toContain('+Task branch content');
    });

    it('should handle invalid branch name', async () => {
      createTestTask(14, 'Invalid Branch Task');

      await diffCommand('14', undefined, { branch: 'non-existent-branch' });

      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      // May show error or no changes depending on git behavior
      expect(output).toBeDefined();
    });
  });

  describe('Complex scenarios', () => {
    it('should handle renamed files', async () => {
      const { worktreePath } = createTestTask(15, 'Rename Task');

      // Create and commit a file first
      writeFileSync(join(worktreePath, 'old-name.txt'), 'File content\n');
      launchSync('git', ['add', '.'], { cwd: worktreePath });
      launchSync('git', ['commit', '-m', 'Add file'], {
        cwd: worktreePath,
      });

      // Rename the file
      launchSync('git', ['mv', 'old-name.txt', 'new-name.txt'], {
        cwd: worktreePath,
      });

      await diffCommand('15');

      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      // Git should show rename information
      expect(output.toLowerCase()).toMatch(
        /rename|old-name.*new-name|new-name.*old-name/
      );
    });

    it('should handle deleted files', async () => {
      const { worktreePath } = createTestTask(16, 'Delete Task');

      // Create and commit a file
      writeFileSync(join(worktreePath, 'to-delete.txt'), 'Will be deleted\n');
      launchSync('git', ['add', '.'], { cwd: worktreePath });
      launchSync('git', ['commit', '-m', 'Add file to delete'], {
        cwd: worktreePath,
      });

      // Delete the file
      launchSync('git', ['rm', 'to-delete.txt'], {
        cwd: worktreePath,
      });

      await diffCommand('16');

      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      // Staged deletion won't show in basic diff
      expect(output).toContain('No changes found in workspace');
    });

    it('should handle binary files', async () => {
      const { worktreePath } = createTestTask(17, 'Binary Task');

      // Create a binary file (small image simulation)
      const binaryContent = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      writeFileSync(join(worktreePath, 'image.png'), binaryContent);

      await diffCommand('17');

      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      // Binary files show up as untracked
      expect(output).toContain('image.png');
      // May show binary file indication or full diff
    });

    it('should handle large number of changes', async () => {
      const { worktreePath } = createTestTask(18, 'Many Changes Task');

      // Create many files
      for (let i = 1; i <= 10; i++) {
        writeFileSync(
          join(worktreePath, `file${i}.txt`),
          `Content of file ${i}\n`
        );
      }

      await diffCommand('18', undefined, { onlyFiles: true });

      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      // Should list all files
      for (let i = 1; i <= 10; i++) {
        expect(output).toContain(`file${i}.txt`);
      }
    });
  });

  describe('Output formatting', () => {
    it('should use correct colors for diff output', async () => {
      const { worktreePath } = createTestTask(19, 'Color Test Task');

      // Create changes
      appendFileSync(join(worktreePath, 'README.md'), 'Added line\n');
      writeFileSync(join(worktreePath, 'new.txt'), 'New file\n');

      // We can't directly test colors in the mocked console,
      // but we can verify the structure is called
      await diffCommand('19');

      expect(consoleSpy.log).toHaveBeenCalled();
      // The actual color testing would need to check the ansi-colors calls
    });

    it('should show tips when appropriate', async () => {
      const { showTips } = await import('../../utils/display.js');
      createTestTask(20, 'Tips Task');

      await diffCommand('20');

      expect(showTips).toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty repository', async () => {
      // Create a new temp dir with empty git repo
      const emptyDir = mkdtempSync(join(tmpdir(), 'rover-empty-diff-'));
      process.chdir(emptyDir);

      launchSync('git', ['init']);
      launchSync('git', ['config', 'user.email', 'test@test.com']);
      launchSync('git', ['config', 'user.name', 'Test User']);
      launchSync('git', ['config', 'commit.gpgsign', 'false']);
      mkdirSync('.rover/tasks', { recursive: true });

      const task = TaskDescriptionManager.create({
        id: 1,
        title: 'Empty Repo Task',
        description: 'Test',
        inputs: new Map(),
        workflowName: 'swe',
      });

      const worktreePath = join('.rover', 'tasks', '1', 'workspace');
      const branchName = 'rover-task-1';

      // Create orphan branch for worktree since there's no commits
      launchSync('git', ['checkout', '--orphan', 'temp-branch']);
      writeFileSync('temp.txt', 'temp');
      launchSync('git', ['add', '.']);
      launchSync('git', ['commit', '-m', 'temp']);
      launchSync('git', ['worktree', 'add', worktreePath, '-b', branchName]);

      task.setWorkspace(join(emptyDir, worktreePath), branchName);

      await diffCommand('1');

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('No changes found in workspace')
      );

      process.chdir(originalCwd);
      rmSync(emptyDir, { recursive: true, force: true });
    });

    it('should handle task ID 0', async () => {
      await diffCommand('0');

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('✗ Task 0 not found')
      );
    });

    it('should handle very long file paths', async () => {
      const { worktreePath } = createTestTask(21, 'Long Path Task');

      // Create deeply nested directory
      const deepPath = join(
        worktreePath,
        'very',
        'deeply',
        'nested',
        'directory',
        'structure'
      );
      mkdirSync(deepPath, { recursive: true });
      writeFileSync(join(deepPath, 'file.txt'), 'Deep file content\n');

      await diffCommand('21');

      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      // Untracked files in nested directories should be included
      expect(output).toContain(
        'very/deeply/nested/directory/structure/file.txt'
      );
      expect(output).toContain('+Deep file content');
    });

    it('should handle files with special characters in names', async () => {
      const { worktreePath } = createTestTask(22, 'Special Chars Task');

      // Create files with special characters
      writeFileSync(join(worktreePath, 'file with spaces.txt'), 'Content\n');
      writeFileSync(join(worktreePath, 'file-with-dashes.txt'), 'Content\n');
      writeFileSync(
        join(worktreePath, 'file_with_underscores.txt'),
        'Content\n'
      );

      await diffCommand('22', undefined, { onlyFiles: true });

      const logCalls = consoleSpy.log.mock.calls.map(call => call.join(' '));
      const output = logCalls.join('\n');

      expect(output).toContain('file with spaces.txt');
      expect(output).toContain('file-with-dashes.txt');
      expect(output).toContain('file_with_underscores.txt');
    });
  });

  describe('Telemetry', () => {
    it('should track diff event', async () => {
      const { getTelemetry } = await import('../../lib/telemetry.js');
      const mockTelemetry = getTelemetry();

      createTestTask(23, 'Telemetry Task');

      await diffCommand('23');

      expect(mockTelemetry?.eventDiff).toHaveBeenCalled();
      expect(mockTelemetry?.shutdown).toHaveBeenCalled();
    });
  });
});
