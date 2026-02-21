import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  detectEnvironment,
  detectLanguages,
  detectPackageManagers,
  detectTaskManagers,
} from '../environment.js';

describe('environment detection', () => {
  let testDir: string;

  beforeEach(() => {
    // Create a unique test directory in system temp
    testDir = join(
      tmpdir(),
      `rover-env-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('detectLanguages', () => {
    it('should detect TypeScript from tsconfig.json', async () => {
      writeFileSync(join(testDir, 'tsconfig.json'), '{}');

      const result = await detectLanguages(testDir);

      expect(result).toContain('typescript');
    });

    it('should detect TypeScript from tsconfig.node.json', async () => {
      writeFileSync(join(testDir, 'tsconfig.node.json'), '{}');

      const result = await detectLanguages(testDir);

      expect(result).toContain('typescript');
    });

    it('should detect JavaScript from package.json', async () => {
      writeFileSync(join(testDir, 'package.json'), '{}');

      const result = await detectLanguages(testDir);

      expect(result).toContain('javascript');
    });

    it('should detect JavaScript from .node-version', async () => {
      writeFileSync(join(testDir, '.node-version'), '22.0.0');

      const result = await detectLanguages(testDir);

      expect(result).toContain('javascript');
    });

    it('should detect Python from pyproject.toml', async () => {
      writeFileSync(join(testDir, 'pyproject.toml'), '');

      const result = await detectLanguages(testDir);

      expect(result).toContain('python');
    });

    it('should detect Python from setup.py', async () => {
      writeFileSync(join(testDir, 'setup.py'), '');

      const result = await detectLanguages(testDir);

      expect(result).toContain('python');
    });

    it('should detect Go from go.mod', async () => {
      writeFileSync(join(testDir, 'go.mod'), 'module test');

      const result = await detectLanguages(testDir);

      expect(result).toContain('go');
    });

    it('should detect Rust from Cargo.toml', async () => {
      writeFileSync(join(testDir, 'Cargo.toml'), '');

      const result = await detectLanguages(testDir);

      expect(result).toContain('rust');
    });

    it('should detect Ruby from Gemfile', async () => {
      writeFileSync(join(testDir, 'Gemfile'), '');

      const result = await detectLanguages(testDir);

      expect(result).toContain('ruby');
    });

    it('should detect Ruby from .ruby-version', async () => {
      writeFileSync(join(testDir, '.ruby-version'), '3.2.0');

      const result = await detectLanguages(testDir);

      expect(result).toContain('ruby');
    });

    it('should detect Dart from pubspec.yaml', async () => {
      writeFileSync(join(testDir, 'pubspec.yaml'), 'name: test_app');

      const result = await detectLanguages(testDir);

      expect(result).toContain('dart');
    });

    it('should detect Dart from pubspec.lock', async () => {
      writeFileSync(join(testDir, 'pubspec.lock'), '');

      const result = await detectLanguages(testDir);

      expect(result).toContain('dart');
    });

    it('should detect PHP from composer.json', async () => {
      writeFileSync(join(testDir, 'composer.json'), '{}');

      const result = await detectLanguages(testDir);

      expect(result).toContain('php');
    });

    it('should detect multiple languages', async () => {
      writeFileSync(join(testDir, 'tsconfig.json'), '{}');
      writeFileSync(join(testDir, 'package.json'), '{}');
      writeFileSync(join(testDir, 'pyproject.toml'), '');

      const result = await detectLanguages(testDir);

      expect(result).toContain('typescript');
      expect(result).toContain('javascript');
      expect(result).toContain('python');
    });

    it('should return empty array for empty directory', async () => {
      const result = await detectLanguages(testDir);

      expect(result).toEqual([]);
    });
  });

  describe('detectPackageManagers', () => {
    it('should detect npm from package-lock.json', async () => {
      writeFileSync(join(testDir, 'package-lock.json'), '{}');

      const result = await detectPackageManagers(testDir);

      expect(result).toContain('npm');
    });

    it('should detect pnpm from pnpm-lock.yaml', async () => {
      writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');

      const result = await detectPackageManagers(testDir);

      expect(result).toContain('pnpm');
    });

    it('should detect yarn from yarn.lock', async () => {
      writeFileSync(join(testDir, 'yarn.lock'), '');

      const result = await detectPackageManagers(testDir);

      expect(result).toContain('yarn');
    });

    it('should detect cargo from Cargo.toml', async () => {
      writeFileSync(join(testDir, 'Cargo.toml'), '');

      const result = await detectPackageManagers(testDir);

      expect(result).toContain('cargo');
    });

    it('should detect gomod from go.mod', async () => {
      writeFileSync(join(testDir, 'go.mod'), 'module test');

      const result = await detectPackageManagers(testDir);

      expect(result).toContain('gomod');
    });

    it('should detect pip from pyproject.toml when no poetry.lock or uv.lock', async () => {
      writeFileSync(join(testDir, 'pyproject.toml'), '');

      const result = await detectPackageManagers(testDir);

      expect(result).toContain('pip');
    });

    it('should not detect pip when poetry.lock exists', async () => {
      writeFileSync(join(testDir, 'pyproject.toml'), '');
      writeFileSync(join(testDir, 'poetry.lock'), '');

      const result = await detectPackageManagers(testDir);

      expect(result).not.toContain('pip');
      expect(result).toContain('poetry');
    });

    it('should not detect pip when uv.lock exists', async () => {
      writeFileSync(join(testDir, 'pyproject.toml'), '');
      writeFileSync(join(testDir, 'uv.lock'), '');

      const result = await detectPackageManagers(testDir);

      expect(result).not.toContain('pip');
      expect(result).toContain('uv');
    });

    it('should detect poetry from poetry.lock', async () => {
      writeFileSync(join(testDir, 'poetry.lock'), '');

      const result = await detectPackageManagers(testDir);

      expect(result).toContain('poetry');
    });

    it('should detect uv from uv.lock', async () => {
      writeFileSync(join(testDir, 'uv.lock'), '');

      const result = await detectPackageManagers(testDir);

      expect(result).toContain('uv');
    });

    it('should detect rubygems from Gemfile', async () => {
      writeFileSync(join(testDir, 'Gemfile'), '');

      const result = await detectPackageManagers(testDir);

      expect(result).toContain('rubygems');
    });

    it('should detect composer from composer.lock', async () => {
      writeFileSync(join(testDir, 'composer.lock'), '');

      const result = await detectPackageManagers(testDir);

      expect(result).toContain('composer');
    });

    it('should detect pub from pubspec.yaml', async () => {
      writeFileSync(join(testDir, 'pubspec.yaml'), 'name: test_app');

      const result = await detectPackageManagers(testDir);

      expect(result).toContain('pub');
    });

    it('should detect pub from pubspec.lock', async () => {
      writeFileSync(join(testDir, 'pubspec.lock'), '');

      const result = await detectPackageManagers(testDir);

      expect(result).toContain('pub');
    });

    it('should detect multiple package managers', async () => {
      writeFileSync(join(testDir, 'package-lock.json'), '{}');
      writeFileSync(join(testDir, 'Cargo.toml'), '');

      const result = await detectPackageManagers(testDir);

      expect(result).toContain('npm');
      expect(result).toContain('cargo');
    });

    it('should return empty array for empty directory', async () => {
      const result = await detectPackageManagers(testDir);

      expect(result).toEqual([]);
    });
  });

  describe('detectTaskManagers', () => {
    it('should detect just from Justfile', async () => {
      writeFileSync(join(testDir, 'Justfile'), '');

      const result = await detectTaskManagers(testDir);

      expect(result).toContain('just');
    });

    it('should detect make from Makefile', async () => {
      writeFileSync(join(testDir, 'Makefile'), '');

      const result = await detectTaskManagers(testDir);

      expect(result).toContain('make');
    });

    it('should detect task from Taskfile.yml', async () => {
      writeFileSync(join(testDir, 'Taskfile.yml'), '');

      const result = await detectTaskManagers(testDir);

      expect(result).toContain('task');
    });

    it('should detect task from Taskfile.yaml', async () => {
      writeFileSync(join(testDir, 'Taskfile.yaml'), '');

      const result = await detectTaskManagers(testDir);

      expect(result).toContain('task');
    });

    it('should detect multiple task managers', async () => {
      writeFileSync(join(testDir, 'Justfile'), '');
      writeFileSync(join(testDir, 'Makefile'), '');

      const result = await detectTaskManagers(testDir);

      expect(result).toContain('just');
      expect(result).toContain('make');
    });

    it('should return empty array for empty directory', async () => {
      const result = await detectTaskManagers(testDir);

      expect(result).toEqual([]);
    });
  });

  describe('detectEnvironment', () => {
    it('should detect full environment for TypeScript/npm project', async () => {
      writeFileSync(join(testDir, 'tsconfig.json'), '{}');
      writeFileSync(join(testDir, 'package.json'), '{}');
      writeFileSync(join(testDir, 'package-lock.json'), '{}');
      writeFileSync(join(testDir, 'Makefile'), '');

      const result = await detectEnvironment(testDir);

      expect(result.languages).toContain('typescript');
      expect(result.languages).toContain('javascript');
      expect(result.packageManagers).toContain('npm');
      expect(result.taskManagers).toContain('make');
    });

    it('should detect full environment for Python/uv project', async () => {
      writeFileSync(join(testDir, 'pyproject.toml'), '');
      writeFileSync(join(testDir, 'uv.lock'), '');
      writeFileSync(join(testDir, 'Justfile'), '');

      const result = await detectEnvironment(testDir);

      expect(result.languages).toContain('python');
      expect(result.packageManagers).toContain('uv');
      expect(result.packageManagers).not.toContain('pip');
      expect(result.taskManagers).toContain('just');
    });

    it('should detect full environment for Rust project', async () => {
      writeFileSync(join(testDir, 'Cargo.toml'), '');
      writeFileSync(join(testDir, 'Cargo.lock'), '');

      const result = await detectEnvironment(testDir);

      expect(result.languages).toContain('rust');
      expect(result.packageManagers).toContain('cargo');
    });

    it('should detect full environment for Dart/Flutter project', async () => {
      writeFileSync(join(testDir, 'pubspec.yaml'), 'name: test_app');
      writeFileSync(join(testDir, 'pubspec.lock'), '');
      writeFileSync(join(testDir, 'Makefile'), '');

      const result = await detectEnvironment(testDir);

      expect(result.languages).toContain('dart');
      expect(result.packageManagers).toContain('pub');
      expect(result.taskManagers).toContain('make');
    });

    it('should return empty arrays for empty directory', async () => {
      const result = await detectEnvironment(testDir);

      expect(result.languages).toEqual([]);
      expect(result.packageManagers).toEqual([]);
      expect(result.taskManagers).toEqual([]);
    });
  });
});
