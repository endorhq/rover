import { describe, expect, it } from 'vitest';
import { getRepoInfo } from '../../commands/push.js';

describe('getRepoInfo', () => {
  describe('GitHub URLs', () => {
    it('parses GitHub SSH URL', () => {
      expect(getRepoInfo('git@github.com:org/repo.git')).toEqual({
        provider: 'github',
        host: 'github.com',
        projectPath: 'org/repo',
      });
    });

    it('parses GitHub SSH URL without .git suffix', () => {
      expect(getRepoInfo('git@github.com:org/repo')).toEqual({
        provider: 'github',
        host: 'github.com',
        projectPath: 'org/repo',
      });
    });

    it('parses GitHub HTTPS URL', () => {
      expect(getRepoInfo('https://github.com/org/repo.git')).toEqual({
        provider: 'github',
        host: 'github.com',
        projectPath: 'org/repo',
      });
    });

    it('parses GitHub HTTPS URL without .git suffix', () => {
      expect(getRepoInfo('https://github.com/org/repo')).toEqual({
        provider: 'github',
        host: 'github.com',
        projectPath: 'org/repo',
      });
    });

    it('parses GitHub SSH alias (e.g., github-personal)', () => {
      expect(getRepoInfo('git@github-personal:org/repo.git')).toEqual({
        provider: 'github',
        host: 'github.com',
        projectPath: 'org/repo',
      });
    });
  });

  describe('GitLab URLs', () => {
    it('parses GitLab SSH URL', () => {
      expect(getRepoInfo('git@gitlab.com:org/repo.git')).toEqual({
        provider: 'gitlab',
        host: 'gitlab.com',
        projectPath: 'org/repo',
      });
    });

    it('parses GitLab HTTPS URL', () => {
      expect(getRepoInfo('https://gitlab.com/org/repo.git')).toEqual({
        provider: 'gitlab',
        host: 'gitlab.com',
        projectPath: 'org/repo',
      });
    });

    it('parses GitLab nested groups SSH URL', () => {
      expect(getRepoInfo('git@gitlab.com:group/subgroup/repo.git')).toEqual({
        provider: 'gitlab',
        host: 'gitlab.com',
        projectPath: 'group/subgroup/repo',
      });
    });

    it('parses GitLab nested groups HTTPS URL', () => {
      expect(getRepoInfo('https://gitlab.com/group/subgroup/repo.git')).toEqual(
        {
          provider: 'gitlab',
          host: 'gitlab.com',
          projectPath: 'group/subgroup/repo',
        }
      );
    });

    it('parses self-hosted GitLab SSH URL', () => {
      expect(getRepoInfo('git@gitlab.mycompany.com:team/project.git')).toEqual({
        provider: 'gitlab',
        host: 'gitlab.mycompany.com',
        projectPath: 'team/project',
      });
    });

    it('parses self-hosted GitLab HTTPS URL', () => {
      expect(
        getRepoInfo('https://gitlab.mycompany.com/team/project.git')
      ).toEqual({
        provider: 'gitlab',
        host: 'gitlab.mycompany.com',
        projectPath: 'team/project',
      });
    });
  });

  describe('non-matching URLs', () => {
    it('returns null for Bitbucket URL', () => {
      expect(getRepoInfo('git@bitbucket.org:team/repo.git')).toBeNull();
    });

    it('returns null for Bitbucket HTTPS URL', () => {
      expect(getRepoInfo('https://bitbucket.org/team/repo.git')).toBeNull();
    });

    it('returns null for unknown host', () => {
      expect(getRepoInfo('git@code.internal.com:team/repo.git')).toBeNull();
    });

    it('returns null for malformed URL', () => {
      expect(getRepoInfo('not-a-url')).toBeNull();
    });
  });
});
