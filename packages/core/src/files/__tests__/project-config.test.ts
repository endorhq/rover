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
import { launchSync } from '../../os.js';
import { clearProjectRootCache } from '../../project-root.js';
import { ProjectConfigManager } from '../project-config.js';

describe('ProjectConfigManager - Environment Variable Configuration', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Clear cache before each test to ensure fresh project root detection
    clearProjectRootCache();

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

    clearProjectRootCache();
  });

  it('should create new config without envs and envsFile fields', () => {
    const config = ProjectConfigManager.create(testDir);

    expect(existsSync('rover.json')).toBe(true);
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));

    expect(jsonData.version).toBe('1.4');

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

    const config = ProjectConfigManager.load(testDir);

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

    const config = ProjectConfigManager.load(testDir);

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

    const config = ProjectConfigManager.load(testDir);

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

    const config = ProjectConfigManager.load(testDir);

    // Should be migrated to 1.2
    expect(config.version).toBe('1.4');

    // Optional fields should not be present
    expect(config.envs).toBeUndefined();
    expect(config.envsFile).toBeUndefined();

    // Check saved file
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.4');
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

    const config = ProjectConfigManager.load(testDir);

    // Should be migrated to 1.2
    expect(config.version).toBe('1.4');

    // Should preserve custom fields
    expect(config.envs).toEqual(['NODE_ENV']);
    expect(config.envsFile).toBe('.env');

    // Check saved file
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.4');
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

    const config = ProjectConfigManager.load(testDir);

    expect(config.version).toBe('1.4');

    // Check saved file has been migrated to 1.2
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.4');
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

    const config = ProjectConfigManager.load(testDir);

    expect(config.version).toBe('1.4');
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

    const config = ProjectConfigManager.load(testDir);

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

    const config = ProjectConfigManager.load(testDir);

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

    const config = ProjectConfigManager.load(testDir);

    // Should remain at version 1.2
    expect(config.version).toBe('1.4');

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
    expect(jsonData.version).toBe('1.4');
    expect(jsonData.mcps).toEqual([]);
    expect(jsonData.envs).toEqual(['NODE_ENV']);
    expect(jsonData.envsFile).toBe('.env');
  });

  it('should create new config without agentImage and initScript fields', () => {
    const config = ProjectConfigManager.create(testDir);

    expect(existsSync('rover.json')).toBe(true);
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));

    // Optional fields should not be present if undefined
    expect('agentImage' in jsonData).toBe(false);
    expect('initScript' in jsonData).toBe(false);

    // Getters should return undefined
    expect(config.agentImage).toBeUndefined();
    expect(config.initScript).toBeUndefined();
  });

  it('should create config with custom agentImage', () => {
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
          sandbox: {
            agentImage: 'custom/agent:v2.0.0',
          },
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    expect(config.agentImage).toBe('custom/agent:v2.0.0');
    expect(config.initScript).toBeUndefined();
  });

  it('should create config with initScript path', () => {
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
          sandbox: {
            initScript: 'scripts/init.sh',
          },
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    expect(config.initScript).toBe('scripts/init.sh');
    expect(config.agentImage).toBeUndefined();
  });

  it('should create config with both agentImage and initScript', () => {
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
          sandbox: {
            agentImage: 'custom/agent:v2.0.0',
            initScript: 'scripts/init.sh',
          },
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    expect(config.agentImage).toBe('custom/agent:v2.0.0');
    expect(config.initScript).toBe('scripts/init.sh');
  });

  it('should migrate from version 1.0 to 1.2 preserving agentImage and initScript', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.0',
          languages: ['typescript'],
          packageManagers: ['npm'],
          taskManagers: [],
          attribution: true,
          agentImage: 'custom/agent:legacy',
          initScript: 'init.sh',
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    // Should be migrated to 1.2
    expect(config.version).toBe('1.4');

    // Should preserve custom fields
    expect(config.agentImage).toBe('custom/agent:legacy');
    expect(config.initScript).toBe('init.sh');

    // Check saved file
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.4');
    expect(jsonData.sandbox.agentImage).toBe('custom/agent:legacy');
    expect(jsonData.sandbox.initScript).toBe('init.sh');
  });

  it('should migrate version 1.1 config with agentImage to 1.2', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.1',
          languages: ['typescript'],
          packageManagers: ['npm'],
          taskManagers: [],
          attribution: true,
          agentImage: 'ghcr.io/custom/rover:v1.0',
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    expect(config.version).toBe('1.4');
    expect(config.agentImage).toBe('ghcr.io/custom/rover:v1.0');

    // Check saved file has been migrated to 1.2
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.4');
    expect(jsonData.sandbox.agentImage).toBe('ghcr.io/custom/rover:v1.0');
  });

  it('should preserve all fields including agentImage and initScript during migration', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.0',
          languages: ['typescript', 'python'],
          packageManagers: ['npm', 'pip'],
          taskManagers: ['make'],
          attribution: false,
          envs: ['NODE_ENV'],
          envsFile: '.env',
          agentImage: 'myregistry/agent:custom',
          initScript: 'scripts/setup.sh',
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    expect(config.version).toBe('1.4');
    expect(config.languages).toEqual(['typescript', 'python']);
    expect(config.packageManagers).toEqual(['npm', 'pip']);
    expect(config.taskManagers).toEqual(['make']);
    expect(config.attribution).toBe(false);
    expect(config.envs).toEqual(['NODE_ENV']);
    expect(config.envsFile).toBe('.env');
    expect(config.agentImage).toBe('myregistry/agent:custom');
    expect(config.initScript).toBe('scripts/setup.sh');
  });

  it('should create new config without hooks field', () => {
    const config = ProjectConfigManager.create(testDir);

    expect(existsSync('rover.json')).toBe(true);
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));

    // Optional hooks field should not be present if undefined
    expect('hooks' in jsonData).toBe(false);

    // Getter should return undefined
    expect(config.hooks).toBeUndefined();
  });

  it('should create config with onMerge hooks', () => {
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
          hooks: {
            onMerge: ['echo "merged"', 'npm run lint'],
          },
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    expect(config.hooks).toEqual({
      onMerge: ['echo "merged"', 'npm run lint'],
    });
    expect(config.hooks?.onMerge).toEqual(['echo "merged"', 'npm run lint']);
    expect(config.hooks?.onPush).toBeUndefined();
  });

  it('should create config with onPush hooks', () => {
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
          hooks: {
            onPush: ['echo "pushed"'],
          },
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    expect(config.hooks).toEqual({
      onPush: ['echo "pushed"'],
    });
    expect(config.hooks?.onPush).toEqual(['echo "pushed"']);
    expect(config.hooks?.onMerge).toBeUndefined();
  });

  it('should create config with both onMerge and onPush hooks', () => {
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
          hooks: {
            onMerge: ['npm run test'],
            onPush: ['npm run deploy'],
          },
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    expect(config.hooks).toEqual({
      onMerge: ['npm run test'],
      onPush: ['npm run deploy'],
    });
  });

  it('should migrate from version 1.1 to 1.2 preserving hooks field', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.1',
          languages: ['typescript'],
          packageManagers: ['npm'],
          taskManagers: [],
          attribution: true,
          hooks: {
            onMerge: ['echo "migrated hook"'],
          },
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    // Should be migrated to 1.2
    expect(config.version).toBe('1.4');

    // Should preserve hooks field
    expect(config.hooks).toEqual({
      onMerge: ['echo "migrated hook"'],
    });

    // Check saved file
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.4');
    expect(jsonData.hooks).toEqual({
      onMerge: ['echo "migrated hook"'],
    });
  });

  it('should handle empty hooks arrays', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.2',
          languages: [],
          packageManagers: [],
          taskManagers: [],
          attribution: true,
          mcps: [],
          hooks: {
            onMerge: [],
            onPush: [],
          },
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    expect(config.hooks?.onMerge).toEqual([]);
    expect(config.hooks?.onPush).toEqual([]);
  });

  it('should preserve all fields including hooks during migration', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.0',
          languages: ['typescript', 'python'],
          packageManagers: ['npm', 'pip'],
          taskManagers: ['make'],
          attribution: false,
          envs: ['NODE_ENV'],
          envsFile: '.env',
          agentImage: 'myregistry/agent:custom',
          initScript: 'scripts/setup.sh',
          hooks: {
            onMerge: ['npm run build'],
            onPush: ['npm run deploy'],
          },
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    expect(config.version).toBe('1.4');
    expect(config.languages).toEqual(['typescript', 'python']);
    expect(config.packageManagers).toEqual(['npm', 'pip']);
    expect(config.taskManagers).toEqual(['make']);
    expect(config.attribution).toBe(false);
    expect(config.envs).toEqual(['NODE_ENV']);
    expect(config.envsFile).toBe('.env');
    expect(config.agentImage).toBe('myregistry/agent:custom');
    expect(config.initScript).toBe('scripts/setup.sh');
    expect(config.hooks).toEqual({
      onMerge: ['npm run build'],
      onPush: ['npm run deploy'],
    });
  });

  it('should create new config without excludePatterns field', () => {
    const config = ProjectConfigManager.create(testDir);

    expect(existsSync('rover.json')).toBe(true);
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));

    // Optional excludePatterns field should not be present if undefined
    expect('excludePatterns' in jsonData).toBe(false);

    // Getter should return undefined
    expect(config.excludePatterns).toBeUndefined();

    // Check saved file
    expect(jsonData.version).toBe('1.4');
    expect('excludePatterns' in jsonData).toBe(false);
  });

  it('should migrate from version 1.2 to 1.3 preserving excludePatterns', () => {
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
          excludePatterns: ['secret/**', '*.key'],
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    // Should be migrated to current version
    expect(config.version).toBe('1.4');

    // Should preserve excludePatterns
    expect(config.excludePatterns).toEqual(['secret/**', '*.key']);

    // Check saved file
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.4');
    expect(jsonData.excludePatterns).toEqual(['secret/**', '*.key']);
  });

  it('should handle empty excludePatterns array', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.3',
          languages: [],
          packageManagers: [],
          taskManagers: [],
          attribution: true,
          mcps: [],
          excludePatterns: [],
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    expect(config.excludePatterns).toEqual([]);
  });

  it('should preserve all fields including excludePatterns during migration', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.0',
          languages: ['typescript', 'python'],
          packageManagers: ['npm', 'pip'],
          taskManagers: ['make'],
          attribution: false,
          envs: ['NODE_ENV'],
          envsFile: '.env',
          agentImage: 'myregistry/agent:custom',
          initScript: 'scripts/setup.sh',
          hooks: {
            onMerge: ['npm run build'],
            onPush: ['npm run deploy'],
          },
          excludePatterns: ['private/**', '*.secret'],
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    expect(config.version).toBe('1.4');
    expect(config.languages).toEqual(['typescript', 'python']);
    expect(config.packageManagers).toEqual(['npm', 'pip']);
    expect(config.taskManagers).toEqual(['make']);
    expect(config.attribution).toBe(false);
    expect(config.envs).toEqual(['NODE_ENV']);
    expect(config.envsFile).toBe('.env');
    expect(config.agentImage).toBe('myregistry/agent:custom');
    expect(config.initScript).toBe('scripts/setup.sh');
    expect(config.hooks).toEqual({
      onMerge: ['npm run build'],
      onPush: ['npm run deploy'],
    });
    expect(config.excludePatterns).toEqual(['private/**', '*.secret']);
  });

  it('should not re-migrate version 1.3 config', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.3',
          languages: ['typescript'],
          packageManagers: ['npm'],
          taskManagers: [],
          attribution: true,
          mcps: [],
          envs: ['NODE_ENV'],
          envsFile: '.env',
          excludePatterns: ['secret/**'],
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    // Should be migrated to 1.4
    expect(config.version).toBe('1.4');

    // All fields should be preserved exactly
    expect(config.languages).toEqual(['typescript']);
    expect(config.packageManagers).toEqual(['npm']);
    expect(config.taskManagers).toEqual([]);
    expect(config.attribution).toBe(true);
    expect(config.mcps).toEqual([]);
    expect(config.envs).toEqual(['NODE_ENV']);
    expect(config.envsFile).toBe('.env');
    expect(config.excludePatterns).toEqual(['secret/**']);

    // Check saved file
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.4');
    expect(jsonData.mcps).toEqual([]);
    expect(jsonData.envs).toEqual(['NODE_ENV']);
    expect(jsonData.envsFile).toBe('.env');
    expect(jsonData.excludePatterns).toEqual(['secret/**']);
  });
});

describe('ProjectConfigManager - Multi-Project Workspace Support', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    clearProjectRootCache();
    testDir = mkdtempSync(join(tmpdir(), 'rover-config-test-'));
    originalCwd = process.cwd();
    process.chdir(testDir);
    launchSync('git', ['init']);
    launchSync('git', ['config', 'user.email', 'test@test.com']);
    launchSync('git', ['config', 'user.name', 'Test User']);
    launchSync('git', ['config', 'commit.gpgsign', 'false']);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
    clearProjectRootCache();
  });

  it('should create new config without projects field', () => {
    const config = ProjectConfigManager.create(testDir);

    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.4');
    expect('projects' in jsonData).toBe(false);
    expect(config.projects).toBeUndefined();
  });

  it('should load config with projects field', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.4',
          languages: ['typescript'],
          mcps: [],
          packageManagers: ['pnpm'],
          taskManagers: [],
          attribution: true,
          projects: [
            {
              name: 'api',
              path: 'packages/api',
              languages: ['python'],
              packageManagers: ['pip'],
              taskManagers: ['make'],
              initScript: 'scripts/init-api.sh',
            },
            {
              name: 'frontend',
              path: 'packages/frontend',
              languages: ['typescript'],
              packageManagers: ['npm'],
            },
          ],
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    expect(config.projects).toHaveLength(2);
    expect(config.projects![0].name).toBe('api');
    expect(config.projects![1].name).toBe('frontend');
  });

  it('should migrate from 1.3 to 1.4 preserving projects field', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.3',
          languages: ['typescript'],
          mcps: [],
          packageManagers: ['pnpm'],
          taskManagers: [],
          attribution: true,
          projects: [
            { name: 'api', path: 'packages/api', languages: ['python'] },
          ],
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    expect(config.version).toBe('1.4');
    expect(config.projects).toHaveLength(1);
    expect(config.projects![0].name).toBe('api');

    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.4');
    expect(jsonData.projects).toHaveLength(1);
  });

  it('should migrate from 1.3 to 1.4 without projects field', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.3',
          languages: ['typescript'],
          mcps: [],
          packageManagers: ['pnpm'],
          taskManagers: [],
          attribution: true,
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    expect(config.version).toBe('1.4');
    expect(config.projects).toBeUndefined();
  });

  it('allLanguages should deduplicate root + sub-project languages', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.4',
          languages: ['typescript', 'python'],
          mcps: [],
          packageManagers: [],
          taskManagers: [],
          attribution: true,
          projects: [
            { name: 'api', path: 'api', languages: ['python', 'go'] },
            { name: 'web', path: 'web', languages: ['typescript', 'ruby'] },
          ],
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);
    const allLangs = config.allLanguages;

    expect(allLangs).toContain('typescript');
    expect(allLangs).toContain('python');
    expect(allLangs).toContain('go');
    expect(allLangs).toContain('ruby');
    // Should be deduplicated
    expect(allLangs.filter(l => l === 'typescript')).toHaveLength(1);
    expect(allLangs.filter(l => l === 'python')).toHaveLength(1);
  });

  it('allLanguages should work without projects', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.4',
          languages: ['typescript'],
          mcps: [],
          packageManagers: [],
          taskManagers: [],
          attribution: true,
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);
    expect(config.allLanguages).toEqual(['typescript']);
  });

  it('allPackageManagers should deduplicate root + sub-project values', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.4',
          languages: [],
          mcps: [],
          packageManagers: ['pnpm'],
          taskManagers: [],
          attribution: true,
          projects: [
            { name: 'api', path: 'api', packageManagers: ['pip', 'pnpm'] },
            { name: 'web', path: 'web', packageManagers: ['npm'] },
          ],
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);
    const allPMs = config.allPackageManagers;

    expect(allPMs).toContain('pnpm');
    expect(allPMs).toContain('pip');
    expect(allPMs).toContain('npm');
    expect(allPMs.filter(pm => pm === 'pnpm')).toHaveLength(1);
  });

  it('allTaskManagers should deduplicate root + sub-project values', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.4',
          languages: [],
          mcps: [],
          packageManagers: [],
          taskManagers: ['make'],
          attribution: true,
          projects: [
            { name: 'api', path: 'api', taskManagers: ['just', 'make'] },
          ],
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);
    const allTMs = config.allTaskManagers;

    expect(allTMs).toContain('make');
    expect(allTMs).toContain('just');
    expect(allTMs.filter(tm => tm === 'make')).toHaveLength(1);
  });

  it('allInitScripts should return root first then sub-projects in order', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.4',
          languages: [],
          mcps: [],
          packageManagers: [],
          taskManagers: [],
          attribution: true,
          sandbox: { initScript: 'init.sh' },
          projects: [
            { name: 'api', path: 'packages/api', initScript: 'setup-api.sh' },
            { name: 'web', path: 'packages/web', initScript: 'setup-web.sh' },
          ],
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);
    const scripts = config.allInitScripts;

    expect(scripts).toHaveLength(3);
    expect(scripts[0]).toEqual({ script: 'init.sh' });
    expect(scripts[1]).toEqual({
      script: 'setup-api.sh',
      path: 'packages/api',
    });
    expect(scripts[2]).toEqual({
      script: 'setup-web.sh',
      path: 'packages/web',
    });
  });

  it('allInitScripts should work with root only', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.4',
          languages: [],
          mcps: [],
          packageManagers: [],
          taskManagers: [],
          attribution: true,
          sandbox: { initScript: 'init.sh' },
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);
    const scripts = config.allInitScripts;

    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toEqual({ script: 'init.sh' });
  });

  it('allInitScripts should return empty array when no scripts', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.4',
          languages: [],
          mcps: [],
          packageManagers: [],
          taskManagers: [],
          attribution: true,
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);
    expect(config.allInitScripts).toEqual([]);
  });

  it('addProject should add a new project', () => {
    const config = ProjectConfigManager.create(testDir);

    config.addProject({
      name: 'api',
      path: 'packages/api',
      languages: ['python'],
    });

    expect(config.projects).toHaveLength(1);
    expect(config.projects![0].name).toBe('api');

    // Verify saved to disk
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.projects).toHaveLength(1);
    expect(jsonData.projects[0].name).toBe('api');
  });

  it('addProject should not add duplicate projects', () => {
    const config = ProjectConfigManager.create(testDir);

    config.addProject({ name: 'api', path: 'packages/api' });
    config.addProject({ name: 'api', path: 'packages/api-v2' });

    expect(config.projects).toHaveLength(1);
    expect(config.projects![0].path).toBe('packages/api');
  });

  it('removeProject should remove an existing project', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.4',
          languages: [],
          mcps: [],
          packageManagers: [],
          taskManagers: [],
          attribution: true,
          projects: [
            { name: 'api', path: 'api' },
            { name: 'web', path: 'web' },
          ],
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);
    config.removeProject('api');

    expect(config.projects).toHaveLength(1);
    expect(config.projects![0].name).toBe('web');
  });

  it('removeProject should remove projects field when last project removed', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.4',
          languages: [],
          mcps: [],
          packageManagers: [],
          taskManagers: [],
          attribution: true,
          projects: [{ name: 'api', path: 'api' }],
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);
    config.removeProject('api');

    expect(config.projects).toBeUndefined();

    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect('projects' in jsonData).toBe(false);
  });

  it('removeProject should be no-op for non-existent project', () => {
    const config = ProjectConfigManager.create(testDir);
    config.removeProject('nonexistent');
    expect(config.projects).toBeUndefined();
  });

  it('backwards compatibility: configs without projects work identically', () => {
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.4',
          languages: ['typescript'],
          mcps: [],
          packageManagers: ['pnpm'],
          taskManagers: ['make'],
          attribution: true,
        },
        null,
        2
      )
    );

    const config = ProjectConfigManager.load(testDir);

    // All aggregate getters should just return root values
    expect(config.allLanguages).toEqual(['typescript']);
    expect(config.allPackageManagers).toEqual(['pnpm']);
    expect(config.allTaskManagers).toEqual(['make']);
    expect(config.allInitScripts).toEqual([]);
    expect(config.projects).toBeUndefined();
  });
});
