import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchSync } from 'rover-common';
import { ProjectConfig } from '../config.js';

describe('ProjectConfig - Environment Variable Configuration', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'rover-config-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Initialize a git repo for testing
    launchSync('git', ['init']);
    launchSync('git', ['config', 'user.email', 'test@test.com']);
    launchSync('git', ['config', 'user.name', 'Test User']);
    launchSync('git', ['config', 'commit.gpgsign', 'false']);
  });

  afterEach(() => {
    // Restore original working directory
    process.chdir(originalCwd);

    // Clean up temp directory
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should create new config without envs and envsFile fields', () => {
    const config = ProjectConfig.create();

    expect(existsSync('rover.json')).toBe(true);
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));

    // Version should be 1.2
    expect(jsonData.version).toBe('1.2');

    // Optional fields should not be present if undefined
    expect('envs' in jsonData).toBe(false);
    expect('envsFile' in jsonData).toBe(false);

    // Getters should return undefined
    expect(config.envs).toBeUndefined();
    expect(config.envsFile).toBeUndefined();
  });

  it('should create config with custom envs array', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.1',
          languages: ['typescript'],
          packageManagers: ['npm'],
          taskManagers: [],
          attribution: true,
          envs: ['NODE_ENV', 'API_KEY=test-key', 'DEBUG'],
        },
        null,
        2
      )
    );

    const config = ProjectConfig.load();

    expect(config.envs).toEqual(['NODE_ENV', 'API_KEY=test-key', 'DEBUG']);
    expect(config.envsFile).toBeUndefined();
  });

  it('should create config with envsFile path', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.1',
          languages: ['typescript'],
          packageManagers: ['npm'],
          taskManagers: [],
          attribution: true,
          envsFile: '.env.rover',
        },
        null,
        2
      )
    );

    const config = ProjectConfig.load();

    expect(config.envsFile).toBe('.env.rover');
    expect(config.envs).toBeUndefined();
  });

  it('should create config with both envs and envsFile', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.1',
          languages: ['typescript'],
          packageManagers: ['npm'],
          taskManagers: [],
          attribution: true,
          envs: ['NODE_ENV', 'DEBUG=true'],
          envsFile: '.env.rover',
        },
        null,
        2
      )
    );

    const config = ProjectConfig.load();

    expect(config.envs).toEqual(['NODE_ENV', 'DEBUG=true']);
    expect(config.envsFile).toBe('.env.rover');
  });

  it('should migrate from version 1.0 to 1.2 without envs fields', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.0',
          languages: ['typescript'],
          packageManagers: ['npm'],
          taskManagers: [],
          attribution: true,
        },
        null,
        2
      )
    );

    const config = ProjectConfig.load();

    // Should be migrated to 1.2
    expect(config.version).toBe('1.2');

    // Optional fields should not be present
    expect(config.envs).toBeUndefined();
    expect(config.envsFile).toBeUndefined();

    // Check saved file
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.2');
    expect('envs' in jsonData).toBe(false);
    expect('envsFile' in jsonData).toBe(false);
  });

  it('should migrate from version 1.0 to 1.2 preserving envs fields', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.0',
          languages: ['typescript'],
          packageManagers: ['npm'],
          taskManagers: [],
          attribution: true,
          envs: ['NODE_ENV'],
          envsFile: '.env',
        },
        null,
        2
      )
    );

    const config = ProjectConfig.load();

    // Should be migrated to 1.2
    expect(config.version).toBe('1.2');

    // Should preserve custom fields
    expect(config.envs).toEqual(['NODE_ENV']);
    expect(config.envsFile).toBe('.env');

    // Check saved file
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.2');
    expect(jsonData.envs).toEqual(['NODE_ENV']);
    expect(jsonData.envsFile).toBe('.env');
  });

  it('should migrate version 1.1 config to 1.2', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.1',
          languages: ['typescript'],
          packageManagers: ['npm'],
          taskManagers: [],
          attribution: true,
          envs: ['NODE_ENV'],
        },
        null,
        2
      )
    );

    const config = ProjectConfig.load();

    expect(config.version).toBe('1.2');

    // Check saved file has been migrated to 1.2
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.2');
    expect(jsonData.envs).toEqual(['NODE_ENV']);
  });

  it('should preserve all existing fields during migration', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.0',
          languages: ['typescript', 'python'],
          packageManagers: ['npm', 'pip'],
          taskManagers: ['make'],
          attribution: false,
        },
        null,
        2
      )
    );

    const config = ProjectConfig.load();

    expect(config.version).toBe('1.2');
    expect(config.languages).toEqual(['typescript', 'python']);
    expect(config.packageManagers).toEqual(['npm', 'pip']);
    expect(config.taskManagers).toEqual(['make']);
    expect(config.attribution).toBe(false);
  });

  it('should handle empty envs array', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.1',
          languages: [],
          packageManagers: [],
          taskManagers: [],
          attribution: true,
          envs: [],
        },
        null,
        2
      )
    );

    const config = ProjectConfig.load();

    expect(config.envs).toEqual([]);
  });

  it('should handle envs with various formats', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.1',
          languages: [],
          packageManagers: [],
          taskManagers: [],
          attribution: true,
          envs: [
            'SIMPLE_VAR',
            'KEY=VALUE',
            'KEY_WITH_EQUALS=VALUE=WITH=EQUALS',
            'EMPTY_KEY=',
          ],
        },
        null,
        2
      )
    );

    const config = ProjectConfig.load();

    expect(config.envs).toEqual([
      'SIMPLE_VAR',
      'KEY=VALUE',
      'KEY_WITH_EQUALS=VALUE=WITH=EQUALS',
      'EMPTY_KEY=',
    ]);
  });

  it('should not re-migrate version 1.2 config', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.2',
          languages: ['typescript'],
          packageManagers: ['npm'],
          taskManagers: [],
          attribution: true,
          mcps: [],
          envs: ['NODE_ENV'],
          envsFile: '.env',
        },
        null,
        2
      )
    );

    const config = ProjectConfig.load();

    // Should remain at version 1.2
    expect(config.version).toBe('1.2');

    // All fields should be preserved exactly
    expect(config.languages).toEqual(['typescript']);
    expect(config.packageManagers).toEqual(['npm']);
    expect(config.taskManagers).toEqual([]);
    expect(config.attribution).toBe(true);
    expect(config.mcps).toEqual([]);
    expect(config.envs).toEqual(['NODE_ENV']);
    expect(config.envsFile).toBe('.env');

    // Check saved file remains unchanged
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.2');
    expect(jsonData.mcps).toEqual([]);
    expect(jsonData.envs).toEqual(['NODE_ENV']);
    expect(jsonData.envsFile).toBe('.env');
  });
});
