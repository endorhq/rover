import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearProjectRootCache, launchSync } from 'rover-core';
import { initCommand } from '../init.js';
import { CURRENT_PROJECT_SCHEMA_VERSION } from 'rover-schemas';

// Mock only the external tool checks (except Git which should be available)
vi.mock('../../utils/system.js', async () => {
  const actual = await vi.importActual('../../utils/system.js');
  return {
    ...actual,
    checkGit: actual.checkGit, // Use real git check
    checkDocker: vi.fn().mockResolvedValue(true),
    checkClaude: vi.fn().mockResolvedValue(true),
    checkCodex: vi.fn().mockResolvedValue(false),
    checkCursor: vi.fn().mockResolvedValue(false),
    checkQwen: vi.fn().mockResolvedValue(false),
    checkGemini: vi.fn().mockResolvedValue(false),
    checkGitHubCLI: vi.fn().mockResolvedValue(false),
  };
});

// Mock telemetry to avoid external calls
vi.mock('../../lib/telemetry.js', () => ({
  getTelemetry: vi.fn().mockReturnValue({
    eventInit: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('init command', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(() => {
    // Create temp directory for testing
    testDir = mkdtempSync(join(tmpdir(), 'rover-init-test-'));
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

    // Clear all mocks
    vi.clearAllMocks();

    clearProjectRootCache();
  });

  it('should create rover.json with detected TypeScript/Node.js environment', async () => {
    // Create project files that will be detected
    writeFileSync(
      'package.json',
      JSON.stringify(
        {
          name: 'test-project',
          version: '1.0.0',
        },
        null,
        2
      )
    );
    writeFileSync(
      'tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
          },
        },
        null,
        2
      )
    );
    writeFileSync('package-lock.json', '{}'); // NPM lock file

    await initCommand('.', { yes: true });

    // Check rover.json was created
    expect(existsSync('rover.json')).toBe(true);

    // Verify content - should detect TypeScript, JavaScript, and NPM
    const roverConfig = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(roverConfig.version).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(roverConfig.languages).toContain('typescript');
    expect(roverConfig.languages).toContain('javascript');
    expect(roverConfig.packageManagers).toContain('npm');
  });

  it('should create .rover/settings.json with AI agent configuration', async () => {
    // Create a simple project file for environment detection
    writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

    await initCommand('.', { yes: true });

    // Check .rover/settings.json was created
    expect(existsSync('.rover/settings.json')).toBe(true);

    // Verify content
    const settings = JSON.parse(readFileSync('.rover/settings.json', 'utf8'));
    expect(settings).toMatchObject({
      version: '1.0',
      aiAgents: ['claude'],
      defaults: {
        aiAgent: 'claude',
      },
    });
  });

  it('should add .rover/ to .gitignore if not present', async () => {
    // Create a simple project file for environment detection
    writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

    await initCommand('.', { yes: true });

    // Check .gitignore was created/updated
    expect(existsSync('.gitignore')).toBe(true);

    // Verify .rover/ was added
    const gitignore = readFileSync('.gitignore', 'utf8');
    expect(gitignore).toContain('.rover/');
  });

  it('should handle existing .gitignore with other entries', async () => {
    // Create existing .gitignore with some content
    writeFileSync('.gitignore', 'node_modules/\ndist/\n');

    // Create a simple project file for environment detection
    writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

    await initCommand('.', { yes: true });

    // Verify .gitignore was updated correctly
    const gitignore = readFileSync('.gitignore', 'utf8');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('dist/');
    expect(gitignore).toContain('.rover/');

    // Ensure .rover/ was only added once
    const roverMatches = gitignore.match(/\.rover\//g);
    expect(roverMatches?.length).toBe(1);
  });

  it('should not duplicate .rover/ entry in .gitignore', async () => {
    // Create .gitignore already containing .rover/
    writeFileSync('.gitignore', '.rover/\nnode_modules/\n');

    // Create a simple project file for environment detection
    writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

    await initCommand('.', { yes: true });

    // Verify .rover/ wasn't duplicated
    const gitignore = readFileSync('.gitignore', 'utf8');
    const roverMatches = gitignore.match(/\.rover\//g);
    expect(roverMatches?.length).toBe(1);
  });

  it('should skip initialization if already initialized', async () => {
    // Create a simple package.json for environment detection
    writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

    // First initialization
    await initCommand('.', { yes: true });

    // Get initial file contents
    const initialRoverConfig = readFileSync('rover.json', 'utf8');
    const initialSettings = readFileSync('.rover/settings.json', 'utf8');

    // Second initialization should skip
    await initCommand('.', { yes: true });

    // Files should remain unchanged
    const finalRoverConfig = readFileSync('rover.json', 'utf8');
    const finalSettings = readFileSync('.rover/settings.json', 'utf8');

    expect(finalRoverConfig).toBe(initialRoverConfig);
    expect(finalSettings).toBe(initialSettings);
  });

  it('should fail gracefully if Docker is not installed', async () => {
    const { checkDocker } = await import('../../utils/system.js');
    vi.mocked(checkDocker).mockResolvedValueOnce(false);

    // Mock process.exit to prevent test from exiting
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('Process exit called');
    });

    await expect(initCommand('.', { yes: true })).rejects.toThrow(
      'Process exit called'
    );

    expect(processExitSpy).toHaveBeenCalledWith(1);
    processExitSpy.mockRestore();
  });

  it('should require at least one AI agent to be installed', async () => {
    const { checkClaude, checkCodex, checkCursor, checkQwen, checkGemini } =
      await import('../../utils/system.js');
    vi.mocked(checkClaude).mockResolvedValueOnce(false);
    vi.mocked(checkCodex).mockResolvedValueOnce(false);
    vi.mocked(checkCursor).mockResolvedValueOnce(false);
    vi.mocked(checkQwen).mockResolvedValueOnce(false);
    vi.mocked(checkGemini).mockResolvedValueOnce(false);

    // Mock process.exit to prevent test from exiting
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('Process exit called');
    });

    await expect(initCommand('.', { yes: true })).rejects.toThrow(
      'Process exit called'
    );

    expect(processExitSpy).toHaveBeenCalledWith(1);
    processExitSpy.mockRestore();
  });

  it('should handle multiple AI agents being available', async () => {
    const { checkClaude, checkCodex, checkCursor, checkQwen, checkGemini } =
      await import('../../utils/system.js');
    vi.mocked(checkClaude).mockResolvedValueOnce(true);
    vi.mocked(checkCodex).mockResolvedValueOnce(false);
    vi.mocked(checkCursor).mockResolvedValueOnce(false);
    vi.mocked(checkQwen).mockResolvedValueOnce(false);
    vi.mocked(checkGemini).mockResolvedValueOnce(true);

    // Create a simple project file for environment detection
    writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

    // With --yes flag, should default to first available (claude)
    await initCommand('.', { yes: true });

    const settings = JSON.parse(readFileSync('.rover/settings.json', 'utf8'));
    expect(settings.aiAgents).toContain('claude');
    expect(settings.aiAgents).toContain('gemini');
    expect(settings.defaults.aiAgent).toBe('claude');
  });

  it('should update existing rover.json if reinitializing user settings', async () => {
    // Create existing rover.json
    writeFileSync(
      'rover.json',
      JSON.stringify(
        {
          version: '1.0',
          languages: ['python'],
          packageManagers: ['pip'],
          taskManagers: [],
        },
        null,
        2
      )
    );

    // Create project files for environment detection
    writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));
    writeFileSync('tsconfig.json', '{}');
    writeFileSync('yarn.lock', ''); // Yarn lock file

    await initCommand('.', { yes: true });

    // rover.json should be updated with new detected values
    const roverConfig = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(roverConfig.languages).toContain('typescript');
    expect(roverConfig.languages).toContain('javascript');
    expect(roverConfig.languages).toContain('python'); // Should keep existing
    expect(roverConfig.packageManagers).toContain('yarn'); // New detected
    expect(roverConfig.packageManagers).toContain('pip'); // Should keep existing

    // User settings should be created
    expect(existsSync('.rover/settings.json')).toBe(true);
  });

  it('should detect Python environment correctly', async () => {
    // Create Python project files
    writeFileSync(
      'pyproject.toml',
      `
[tool.poetry]
name = "test-project"
version = "0.1.0"
    `
    );
    writeFileSync('poetry.lock', ''); // Poetry lock file

    await initCommand('.', { yes: true });

    const roverConfig = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(roverConfig.languages).toContain('python');
    expect(roverConfig.packageManagers).toContain('poetry');
  });

  it('should detect Rust environment correctly', async () => {
    // Create Rust project files (note: lowercase for detection)
    writeFileSync(
      'Cargo.toml',
      `
[package]
name = "test-project"
version = "0.1.0"
    `
    );
    writeFileSync('Cargo.lock', ''); // Cargo lock file

    await initCommand('.', { yes: true });

    const roverConfig = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(roverConfig.languages).toContain('rust');
    expect(roverConfig.packageManagers).toContain('cargo');
  });

  it('should detect task managers correctly', async () => {
    // Create task manager files
    writeFileSync('Makefile', 'test:\n\techo "test"');
    writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

    await initCommand('.', { yes: true });

    const roverConfig = JSON.parse(readFileSync('rover.json', 'utf8'));
    expect(roverConfig.taskManagers).toContain('make');
  });

  it('should detect multiple languages and package managers', async () => {
    // Create a polyglot project
    writeFileSync(
      'package.json',
      JSON.stringify({ name: 'frontend' }, null, 2)
    );
    writeFileSync('tsconfig.json', '{}');
    writeFileSync('pnpm-lock.yaml', ''); // PNPM lock
    writeFileSync('go.mod', 'module test\n\ngo 1.21');
    writeFileSync('go.sum', '');
    writeFileSync('pyproject.toml', '[tool.poetry]\nname = "scripts"');
    writeFileSync('uv.lock', ''); // UV lock

    await initCommand('.', { yes: true });

    const roverConfig = JSON.parse(readFileSync('rover.json', 'utf8'));

    // Should detect all languages
    expect(roverConfig.languages).toContain('typescript');
    expect(roverConfig.languages).toContain('javascript');
    expect(roverConfig.languages).toContain('go');
    expect(roverConfig.languages).toContain('python');

    // Should detect all package managers
    expect(roverConfig.packageManagers).toContain('pnpm');
    expect(roverConfig.packageManagers).toContain('gomod');
    expect(roverConfig.packageManagers).toContain('uv');
  });
});
