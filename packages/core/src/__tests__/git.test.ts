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
