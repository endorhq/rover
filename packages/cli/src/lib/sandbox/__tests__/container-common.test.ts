import { describe, it, expect, afterEach } from 'vitest';
import {
  normalizeExtraArgs,
  getWorktreeGitMounts,
  getCheckpointArgs,
} from '../container-common.js';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('normalizeExtraArgs', () => {
  it('should return empty array for undefined input', () => {
    expect(normalizeExtraArgs(undefined)).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    expect(normalizeExtraArgs('')).toEqual([]);
  });

  it('should return array as-is when input is array', () => {
    const input = ['--network', 'mynet', '--memory', '512m'];
    expect(normalizeExtraArgs(input)).toEqual(input);
  });

  it('should return empty array as-is', () => {
    expect(normalizeExtraArgs([])).toEqual([]);
  });

  it('should split simple string by whitespace', () => {
    expect(normalizeExtraArgs('--network mynet')).toEqual([
      '--network',
      'mynet',
    ]);
  });

  it('should handle single argument string', () => {
    expect(normalizeExtraArgs('--rm')).toEqual(['--rm']);
  });

  it('should handle multiple arguments', () => {
    expect(normalizeExtraArgs('--network mynet --memory 512m')).toEqual([
      '--network',
      'mynet',
      '--memory',
      '512m',
    ]);
  });

  it('should preserve double-quoted strings', () => {
    expect(
      normalizeExtraArgs('--add-host "host.docker.internal:host-gateway"')
    ).toEqual(['--add-host', '"host.docker.internal:host-gateway"']);
  });

  it('should preserve single-quoted strings', () => {
    expect(normalizeExtraArgs("--label 'my label with spaces'")).toEqual([
      '--label',
      "'my label with spaces'",
    ]);
  });

  it('should handle complex real-world example', () => {
    expect(
      normalizeExtraArgs(
        '--network myproject_default --add-host host.docker.internal:host-gateway'
      )
    ).toEqual([
      '--network',
      'myproject_default',
      '--add-host',
      'host.docker.internal:host-gateway',
    ]);
  });
});

describe('getCheckpointArgs', () => {
  const tmpDirs: string[] = [];

  function createTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'rover-test-checkpoint-'));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('returns checkpoint flags when file exists', () => {
    const dir = createTmpDir();
    const checkpointPath = join(dir, 'checkpoint.json');
    writeFileSync(checkpointPath, '{}');
    expect(getCheckpointArgs(checkpointPath)).toEqual([
      '--checkpoint',
      '/output/checkpoint.json',
    ]);
  });

  it('returns empty array when file does not exist', () => {
    expect(getCheckpointArgs('/nonexistent/checkpoint.json')).toEqual([]);
  });

  it('returns empty array when path is undefined', () => {
    expect(getCheckpointArgs(undefined)).toEqual([]);
  });
});

describe('getWorktreeGitMounts', () => {
  const tmpDirs: string[] = [];

  function createTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'rover-test-worktree-'));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('returns empty array when .git is a directory (regular repo)', () => {
    const dir = createTmpDir();
    mkdirSync(join(dir, '.git'));
    expect(getWorktreeGitMounts(dir)).toEqual([]);
  });

  it('returns empty array when .git does not exist', () => {
    const dir = createTmpDir();
    expect(getWorktreeGitMounts(dir)).toEqual([]);
  });

  it('returns mount args for valid worktree .git file', () => {
    const dir = createTmpDir();

    // Simulate the parent repo's .git/worktrees/<id> structure
    const parentGitDir = join(dir, 'repo', '.git');
    const worktreeMetaDir = join(parentGitDir, 'worktrees', '13');
    mkdirSync(worktreeMetaDir, { recursive: true });

    // Create the worktree directory with a .git file pointing to the metadata dir
    const worktreeDir = join(dir, 'worktree');
    mkdirSync(worktreeDir);
    writeFileSync(join(worktreeDir, '.git'), `gitdir: ${worktreeMetaDir}\n`);

    const result = getWorktreeGitMounts(worktreeDir);

    expect(result).toEqual([
      '-v',
      `${parentGitDir}:${parentGitDir}:Z,ro`,
      '-v',
      `${join(parentGitDir, 'objects')}:${join(parentGitDir, 'objects')}:Z,rw`,
      '-v',
      `${worktreeMetaDir}:${worktreeMetaDir}:Z,rw`,
    ]);
  });

  it('returns empty array when .git file has invalid format', () => {
    const dir = createTmpDir();
    writeFileSync(join(dir, '.git'), 'random text');
    expect(getWorktreeGitMounts(dir)).toEqual([]);
  });

  it('returns empty array when resolved parent .git dir does not exist', () => {
    const dir = createTmpDir();
    // Point to a non-existent path
    writeFileSync(
      join(dir, '.git'),
      'gitdir: /tmp/nonexistent-repo/.git/worktrees/99\n'
    );
    expect(getWorktreeGitMounts(dir)).toEqual([]);
  });
});
