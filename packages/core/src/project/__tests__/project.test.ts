import { join } from 'node:path';
import type { GlobalProject } from 'rover-schemas';
import { describe, expect, it } from 'vitest';
import { ProjectManager } from '../project.js';

describe('ProjectManager', () => {
  const basePath = '/data/projects';
  const sampleProject: GlobalProject = {
    id: 'my-project-abc12345',
    path: '/home/user/projects/my-project',
    repositoryName: 'my-project',
    languages: ['typescript', 'javascript'],
    packageManagers: ['npm', 'pnpm'],
    taskManagers: ['make'],
  };

  describe('getters', () => {
    it('should return project id', () => {
      const manager = new ProjectManager(sampleProject, basePath);
      expect(manager.id).toBe('my-project-abc12345');
    });

    it('should return project path', () => {
      const manager = new ProjectManager(sampleProject, basePath);
      expect(manager.path).toBe('/home/user/projects/my-project');
    });

    it('should return project name (repositoryName)', () => {
      const manager = new ProjectManager(sampleProject, basePath);
      expect(manager.name).toBe('my-project');
    });

    it('should return languages', () => {
      const manager = new ProjectManager(sampleProject, basePath);
      expect(manager.languages).toEqual(['typescript', 'javascript']);
    });

    it('should return package managers', () => {
      const manager = new ProjectManager(sampleProject, basePath);
      expect(manager.packageManagers).toEqual(['npm', 'pnpm']);
    });

    it('should return task managers', () => {
      const manager = new ProjectManager(sampleProject, basePath);
      expect(manager.taskManagers).toEqual(['make']);
    });
  });

  describe('path getters', () => {
    it('should return correct tasks path', () => {
      const manager = new ProjectManager(sampleProject, basePath);
      expect(manager.tasksPath).toBe(
        join(basePath, 'my-project-abc12345', 'tasks')
      );
    });

    it('should return correct workspaces path', () => {
      const manager = new ProjectManager(sampleProject, basePath);
      expect(manager.workspacesPath).toBe(
        join(basePath, 'my-project-abc12345', 'workspaces')
      );
    });

    it('should return correct logs path', () => {
      const manager = new ProjectManager(sampleProject, basePath);
      expect(manager.logsPath).toBe(
        join(basePath, 'my-project-abc12345', 'logs')
      );
    });
  });

  describe('toJSON', () => {
    it('should return a copy of the project data', () => {
      const manager = new ProjectManager(sampleProject, basePath);
      const json = manager.toJSON();

      expect(json).toEqual(sampleProject);
      expect(json).not.toBe(sampleProject); // Should be a copy
    });

    it('should not expose internal references', () => {
      const manager = new ProjectManager(sampleProject, basePath);
      const json = manager.toJSON();

      // Modifying the returned object should not affect the manager
      json.repositoryName = 'modified';
      expect(manager.name).toBe('my-project');
    });
  });

  describe('empty project', () => {
    it('should handle project with empty arrays', () => {
      const emptyProject: GlobalProject = {
        id: 'empty-project-12345678',
        path: '/path/to/empty',
        repositoryName: 'empty',
        languages: [],
        packageManagers: [],
        taskManagers: [],
      };

      const manager = new ProjectManager(emptyProject, basePath);

      expect(manager.languages).toEqual([]);
      expect(manager.packageManagers).toEqual([]);
      expect(manager.taskManagers).toEqual([]);
    });
  });
});
