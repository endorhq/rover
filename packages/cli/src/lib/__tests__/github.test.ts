import { describe, expect, it, vi } from 'vitest';

vi.mock('rover-core', async () => {
  const actual = await vi.importActual('rover-core');
  return {
    ...actual,
    launch: vi.fn(),
    launchSync: vi.fn(),
  };
});

import { GitHub } from '../github.js';

describe('getGitHubRepoInfo', () => {
  const github = new GitHub();

  it('parses standard SSH URL', () => {
    expect(github.getGitHubRepoInfo('git@github.com:org/repo.git')).toEqual({
      owner: 'org',
      repo: 'repo',
    });
  });

  it('parses standard SSH URL without .git suffix', () => {
    expect(github.getGitHubRepoInfo('git@github.com:org/repo')).toEqual({
      owner: 'org',
      repo: 'repo',
    });
  });

  it('parses standard HTTPS URL', () => {
    expect(github.getGitHubRepoInfo('https://github.com/org/repo.git')).toEqual(
      {
        owner: 'org',
        repo: 'repo',
      }
    );
  });

  it('parses HTTPS URL without .git suffix', () => {
    expect(github.getGitHubRepoInfo('https://github.com/org/repo')).toEqual({
      owner: 'org',
      repo: 'repo',
    });
  });

  it('parses SSH alias with underscore (github.com_work)', () => {
    expect(
      github.getGitHubRepoInfo('git@github.com_work:org/repo.git')
    ).toEqual({
      owner: 'org',
      repo: 'repo',
    });
  });

  it('parses SSH alias with dash (github-personal)', () => {
    expect(
      github.getGitHubRepoInfo('git@github-personal:org/repo.git')
    ).toEqual({
      owner: 'org',
      repo: 'repo',
    });
  });

  it('parses ssh:// protocol URL', () => {
    expect(
      github.getGitHubRepoInfo('ssh://git@github.com/org/repo.git')
    ).toEqual({
      owner: 'org',
      repo: 'repo',
    });
  });

  it('returns null for non-GitHub URL', () => {
    expect(github.getGitHubRepoInfo('git@gitlab.com:org/repo.git')).toBeNull();
  });

  it('returns null for non-GitHub HTTPS URL', () => {
    expect(
      github.getGitHubRepoInfo('https://gitlab.com/org/repo.git')
    ).toBeNull();
  });
});
