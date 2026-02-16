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

    // Version should be 1.2
    expect(jsonData.version).toBe('1.3');

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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

    // Should be migrated to 1.2
    expect(config.version).toBe('1.3');

    // Optional fields should not be present
    expect(config.envs).toBeUndefined();
    expect(config.envsFile).toBeUndefined();

    // Check saved file
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.3');
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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

    // Should be migrated to 1.2
    expect(config.version).toBe('1.3');

    // Should preserve custom fields
    expect(config.envs).toEqual(['NODE_ENV']);
    expect(config.envsFile).toBe('.env');

    // Check saved file
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.3');
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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

    expect(config.version).toBe('1.3');

    // Check saved file has been migrated to 1.2
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.3');
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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

    expect(config.version).toBe('1.3');
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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

    // Should remain at version 1.2
    expect(config.version).toBe('1.3');

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
    expect(jsonData.version).toBe('1.3');
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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

    // Should be migrated to 1.2
    expect(config.version).toBe('1.3');

    // Should preserve custom fields
    expect(config.agentImage).toBe('custom/agent:legacy');
    expect(config.initScript).toBe('init.sh');

    // Check saved file
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.3');
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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

    expect(config.version).toBe('1.3');
    expect(config.agentImage).toBe('ghcr.io/custom/rover:v1.0');

    // Check saved file has been migrated to 1.2
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.3');
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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

    expect(config.version).toBe('1.3');
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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

    // Should be migrated to 1.2
    expect(config.version).toBe('1.3');

    // Should preserve hooks field
    expect(config.hooks).toEqual({
      onMerge: ['echo "migrated hook"'],
    });

    // Check saved file
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.3');
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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

    expect(config.version).toBe('1.3');
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
    expect(jsonData.version).toBe('1.3');
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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

    // Should be migrated to 1.3
    expect(config.version).toBe('1.3');

    // Should preserve excludePatterns
    expect(config.excludePatterns).toEqual(['secret/**', '*.key']);

    // Check saved file
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.3');
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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

    expect(config.version).toBe('1.3');
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

    const config = ProjectConfigManager.maybeLoad(testDir)!;

    // Should remain at version 1.3
    expect(config.version).toBe('1.3');

    // All fields should be preserved exactly
    expect(config.languages).toEqual(['typescript']);
    expect(config.packageManagers).toEqual(['npm']);
    expect(config.taskManagers).toEqual([]);
    expect(config.attribution).toBe(true);
    expect(config.mcps).toEqual([]);
    expect(config.envs).toEqual(['NODE_ENV']);
    expect(config.envsFile).toBe('.env');
    expect(config.excludePatterns).toEqual(['secret/**']);

    // Check saved file remains unchanged
    const jsonData = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(jsonData.version).toBe('1.3');
    expect(jsonData.mcps).toEqual([]);
    expect(jsonData.envs).toEqual(['NODE_ENV']);
    expect(jsonData.envsFile).toBe('.env');
    expect(jsonData.excludePatterns).toEqual(['secret/**']);
  });
});
