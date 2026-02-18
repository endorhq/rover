import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Git, GitError } from '../git.js';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchSync } from '../os.js';

describe('Git', () => {
  let testDir: string;
  let git: Git;

  beforeEach(() => {
    // Create a unique test directory
    testDir = join(
      tmpdir(),
      `git-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });

    // Initialize a git repo
    launchSync('git', ['init'], { cwd: testDir });
    launchSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: testDir,
    });
    launchSync('git', ['config', 'user.name', 'Test User'], { cwd: testDir });
    launchSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: testDir });

    git = new Git({ cwd: testDir });
  });

  afterEach(() => {
    // Clean up the test directory
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('isWorktree', () => {
    it('should return false for a regular repository', () => {
      // Create an initial commit so worktrees can be created
      writeFileSync(join(testDir, 'README.md'), '# Test');
      launchSync('git', ['add', '.'], { cwd: testDir });
      launchSync('git', ['commit', '-m', 'Initial commit'], { cwd: testDir });

      expect(git.isWorktree()).toBe(false);
    });

    it('should return true when inside a worktree', () => {
      // Create an initial commit
      writeFileSync(join(testDir, 'README.md'), '# Test');
      launchSync('git', ['add', '.'], { cwd: testDir });
      launchSync('git', ['commit', '-m', 'Initial commit'], { cwd: testDir });

      // Create a worktree
      const worktreePath = join(testDir, 'my-worktree');
      launchSync('git', ['worktree', 'add', worktreePath, '-b', 'wt-branch'], {
        cwd: testDir,
      });

      const worktreeGit = new Git({ cwd: worktreePath });
      expect(worktreeGit.isWorktree()).toBe(true);

      // Cleanup
      launchSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: testDir,
        reject: false,
      });
    });

    it('should return true from a subdirectory inside a worktree', () => {
      // Create an initial commit with a subdirectory
      mkdirSync(join(testDir, 'src'), { recursive: true });
      writeFileSync(join(testDir, 'src', 'index.ts'), 'export {};');
      launchSync('git', ['add', '.'], { cwd: testDir });
      launchSync('git', ['commit', '-m', 'Initial commit'], { cwd: testDir });

      // Create a worktree
      const worktreePath = join(testDir, 'my-worktree');
      launchSync('git', ['worktree', 'add', worktreePath, '-b', 'wt-branch'], {
        cwd: testDir,
      });

      const subDirGit = new Git({ cwd: join(worktreePath, 'src') });
      expect(subDirGit.isWorktree()).toBe(true);

      // Cleanup
      launchSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: testDir,
        reject: false,
      });
    });
  });

  describe('getMainRepositoryRoot', () => {
    it('should return the same root as getRepositoryRoot for a regular repo', () => {
      writeFileSync(join(testDir, 'README.md'), '# Test');
      launchSync('git', ['add', '.'], { cwd: testDir });
      launchSync('git', ['commit', '-m', 'Initial commit'], { cwd: testDir });

      expect(git.getMainRepositoryRoot()).toBe(git.getRepositoryRoot());
    });

    it('should return the main repo root when inside a worktree', () => {
      writeFileSync(join(testDir, 'README.md'), '# Test');
      launchSync('git', ['add', '.'], { cwd: testDir });
      launchSync('git', ['commit', '-m', 'Initial commit'], { cwd: testDir });

      // Create a worktree
      const worktreePath = join(testDir, 'my-worktree');
      launchSync('git', ['worktree', 'add', worktreePath, '-b', 'wt-branch'], {
        cwd: testDir,
      });

      const worktreeGit = new Git({ cwd: worktreePath });

      // getRepositoryRoot returns the worktree path
      expect(worktreeGit.getRepositoryRoot()).toBe(worktreePath);
      // getMainRepositoryRoot returns the main repo root
      expect(worktreeGit.getMainRepositoryRoot()).toBe(testDir);

      // Cleanup
      launchSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: testDir,
        reject: false,
      });
    });

    it('should return the main repo root from a nested subdirectory inside a worktree', () => {
      mkdirSync(join(testDir, 'src'), { recursive: true });
      writeFileSync(join(testDir, 'src', 'index.ts'), 'export {};');
      launchSync('git', ['add', '.'], { cwd: testDir });
      launchSync('git', ['commit', '-m', 'Initial commit'], { cwd: testDir });

      const worktreePath = join(testDir, 'my-worktree');
      launchSync('git', ['worktree', 'add', worktreePath, '-b', 'wt-branch'], {
        cwd: testDir,
      });

      const subDirGit = new Git({ cwd: join(worktreePath, 'src') });
      expect(subDirGit.getMainRepositoryRoot()).toBe(testDir);

      // Cleanup
      launchSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: testDir,
        reject: false,
      });
    });
  });

  describe('setupSparseCheckout', () => {
    let worktreePath: string;

    beforeEach(() => {
      // Create some test files
      writeFileSync(join(testDir, 'README.md'), '# Test Project');
      writeFileSync(join(testDir, 'public.ts'), 'export const public = true;');
      writeFileSync(
        join(testDir, 'secret.ts'),
        'export const secret = "password123";'
      );

      // Create subdirectory with files
      mkdirSync(join(testDir, 'src'), { recursive: true });
      writeFileSync(join(testDir, 'src', 'index.ts'), 'export * from "./app";');
      writeFileSync(join(testDir, 'src', 'app.ts'), 'export const app = {};');

      mkdirSync(join(testDir, 'internal'), { recursive: true });
      writeFileSync(
        join(testDir, 'internal', 'config.ts'),
        'export const config = {};'
      );
      writeFileSync(
        join(testDir, 'internal', 'secrets.ts'),
        'export const secrets = {};'
      );

      // Commit the files
      launchSync('git', ['add', '-A'], { cwd: testDir });
      launchSync('git', ['commit', '-m', 'Initial commit'], { cwd: testDir });

      // Create a worktree
      worktreePath = join(testDir, 'worktree');
      git.createWorktree(worktreePath, 'test-branch');
    });

    afterEach(() => {
      // Remove the worktree
      if (existsSync(worktreePath)) {
        launchSync('git', ['worktree', 'remove', '--force', worktreePath], {
          cwd: testDir,
          reject: false,
        });
      }
    });

    it('should exclude files matching a simple pattern', () => {
      // Setup sparse checkout to exclude secret.ts
      git.setupSparseCheckout(worktreePath, ['secret.ts']);

      // Check that secret.ts is not in the worktree
      expect(existsSync(join(worktreePath, 'secret.ts'))).toBe(false);

      // Check that other files still exist
      expect(existsSync(join(worktreePath, 'README.md'))).toBe(true);
      expect(existsSync(join(worktreePath, 'public.ts'))).toBe(true);
      expect(existsSync(join(worktreePath, 'src', 'index.ts'))).toBe(true);
    });

    it('should exclude files matching a glob pattern', () => {
      // Setup sparse checkout to exclude all .ts files in internal/
      git.setupSparseCheckout(worktreePath, ['internal/**']);

      // Check that internal files are not in the worktree
      expect(existsSync(join(worktreePath, 'internal', 'config.ts'))).toBe(
        false
      );
      expect(existsSync(join(worktreePath, 'internal', 'secrets.ts'))).toBe(
        false
      );

      // Check that other files still exist
      expect(existsSync(join(worktreePath, 'README.md'))).toBe(true);
      expect(existsSync(join(worktreePath, 'src', 'index.ts'))).toBe(true);
    });

    it('should exclude files matching multiple patterns', () => {
      // Setup sparse checkout to exclude multiple patterns
      git.setupSparseCheckout(worktreePath, ['secret.ts', 'internal/**']);

      // Check that excluded files are not in the worktree
      expect(existsSync(join(worktreePath, 'secret.ts'))).toBe(false);
      expect(existsSync(join(worktreePath, 'internal', 'config.ts'))).toBe(
        false
      );
      expect(existsSync(join(worktreePath, 'internal', 'secrets.ts'))).toBe(
        false
      );

      // Check that other files still exist
      expect(existsSync(join(worktreePath, 'README.md'))).toBe(true);
      expect(existsSync(join(worktreePath, 'public.ts'))).toBe(true);
      expect(existsSync(join(worktreePath, 'src', 'index.ts'))).toBe(true);
    });

    it('should not show excluded files as deleted in git status', () => {
      // Setup sparse checkout
      git.setupSparseCheckout(worktreePath, ['secret.ts', 'internal/**']);

      // Check git status - excluded files should NOT appear as deleted
      const worktreeGit = new Git({ cwd: worktreePath });
      const uncommittedChanges = worktreeGit.uncommittedChanges();

      // There should be no changes - the files are simply not checked out
      expect(uncommittedChanges.length).toBe(0);
    });

    it('should do nothing when excludePatterns is empty', () => {
      // Setup sparse checkout with empty patterns
      git.setupSparseCheckout(worktreePath, []);

      // All files should still exist
      expect(existsSync(join(worktreePath, 'README.md'))).toBe(true);
      expect(existsSync(join(worktreePath, 'public.ts'))).toBe(true);
      expect(existsSync(join(worktreePath, 'secret.ts'))).toBe(true);
      expect(existsSync(join(worktreePath, 'src', 'index.ts'))).toBe(true);
      expect(existsSync(join(worktreePath, 'internal', 'config.ts'))).toBe(
        true
      );
    });

    it('should handle patterns with leading slashes', () => {
      // Setup sparse checkout with leading slash pattern
      git.setupSparseCheckout(worktreePath, ['/secret.ts']);

      // Check that secret.ts is not in the worktree
      expect(existsSync(join(worktreePath, 'secret.ts'))).toBe(false);

      // Check that other files still exist
      expect(existsSync(join(worktreePath, 'README.md'))).toBe(true);
    });
  });
});
