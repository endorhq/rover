import { describe, it, expect } from 'vitest';
import { SubProjectSchema, ProjectConfigSchema } from '../schema.js';

describe('SubProjectSchema', () => {
  it('should accept a valid sub-project with all fields', () => {
    const result = SubProjectSchema.parse({
      name: 'backend',
      path: 'packages/backend',
      languages: ['typescript', 'python'],
      packageManagers: ['pnpm', 'pip'],
      taskManagers: ['make'],
      initScript: 'scripts/init-backend.sh',
    });

    expect(result.name).toBe('backend');
    expect(result.path).toBe('packages/backend');
    expect(result.languages).toEqual(['typescript', 'python']);
    expect(result.packageManagers).toEqual(['pnpm', 'pip']);
    expect(result.taskManagers).toEqual(['make']);
    expect(result.initScript).toBe('scripts/init-backend.sh');
  });

  it('should accept a sub-project with only required fields', () => {
    const result = SubProjectSchema.parse({
      name: 'frontend',
      path: 'packages/frontend',
    });

    expect(result.name).toBe('frontend');
    expect(result.path).toBe('packages/frontend');
    expect(result.languages).toBeUndefined();
    expect(result.packageManagers).toBeUndefined();
    expect(result.taskManagers).toBeUndefined();
    expect(result.initScript).toBeUndefined();
  });

  it('should reject a sub-project without name', () => {
    expect(() =>
      SubProjectSchema.parse({ path: 'packages/backend' })
    ).toThrow();
  });

  it('should reject a sub-project without path', () => {
    expect(() => SubProjectSchema.parse({ name: 'backend' })).toThrow();
  });

  it('should reject invalid language values', () => {
    expect(() =>
      SubProjectSchema.parse({
        name: 'test',
        path: 'test',
        languages: ['invalid-lang'],
      })
    ).toThrow();
  });

  it('should reject invalid package manager values', () => {
    expect(() =>
      SubProjectSchema.parse({
        name: 'test',
        path: 'test',
        packageManagers: ['invalid-pm'],
      })
    ).toThrow();
  });
});

describe('ProjectConfigSchema with projects', () => {
  const baseConfig = {
    version: '1.4',
    languages: ['typescript'] as const,
    mcps: [],
    packageManagers: ['pnpm'] as const,
    taskManagers: [] as const,
    attribution: true,
  };

  it('should accept a config without projects field', () => {
    const result = ProjectConfigSchema.parse(baseConfig);
    expect(result.projects).toBeUndefined();
  });

  it('should accept a config with empty projects array', () => {
    const result = ProjectConfigSchema.parse({
      ...baseConfig,
      projects: [],
    });
    expect(result.projects).toEqual([]);
  });

  it('should accept a config with valid projects', () => {
    const result = ProjectConfigSchema.parse({
      ...baseConfig,
      projects: [
        {
          name: 'api',
          path: 'packages/api',
          languages: ['typescript'],
          packageManagers: ['pnpm'],
        },
        {
          name: 'worker',
          path: 'packages/worker',
          languages: ['python'],
          packageManagers: ['pip'],
          initScript: 'scripts/setup-worker.sh',
        },
      ],
    });

    expect(result.projects).toHaveLength(2);
    expect(result.projects?.[0].name).toBe('api');
    expect(result.projects?.[1].languages).toEqual(['python']);
  });

  it('should reject a config with invalid projects entries', () => {
    expect(() =>
      ProjectConfigSchema.parse({
        ...baseConfig,
        projects: [{ invalid: true }],
      })
    ).toThrow();
  });
});
