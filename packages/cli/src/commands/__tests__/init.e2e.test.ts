import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

/**
 * E2E tests for `rover init` command
 *
 * These tests run the actual rover CLI binary and test the full initialization workflow.
 * They mock system tool availability by creating wrapper scripts in a temporary bin directory.
 */

describe('rover init (e2e)', () => {
  let testDir: string;
  let originalCwd: string;
  let mockBinDir: string;
  let originalPath: string;

  /**
   * Creates a mock executable in the mock bin directory
   * This allows us to control which tools appear "installed" to the rover CLI
   */
  const createMockTool = (
    toolName: string,
    exitCode: number = 0,
    output: string = 'mock version 1.0.0'
  ) => {
    const scriptPath = join(mockBinDir, toolName);
    const scriptContent = `#!/usr/bin/env bash\necho "${output}"\nexit ${exitCode}`;
    writeFileSync(scriptPath, scriptContent);
    chmodSync(scriptPath, 0o755);
  };

  beforeEach(async () => {
    // Save original state
    originalCwd = process.cwd();
    originalPath = process.env.PATH || '';

    // Create temporary test directory
    testDir = mkdtempSync(join(tmpdir(), 'rover-init-e2e-'));
    process.chdir(testDir);

    // Create mock bin directory for mocking system tools
    mockBinDir = join(testDir, '.mock-bin');
    mkdirSync(mockBinDir, { recursive: true });

    // Prepend mock bin to PATH so our mock tools are found first
    process.env.PATH = `${mockBinDir}:${originalPath}`;

    // Create failing mocks for all tools by default
    // This ensures that only explicitly enabled tools will be detected
    createMockTool('docker', 127, 'command not found: docker');
    createMockTool('claude', 127, 'command not found: claude');
    createMockTool('codex', 127, 'command not found: codex');
    createMockTool('gemini', 127, 'command not found: gemini');
    createMockTool('qwen', 127, 'command not found: qwen');

    // Initialize a real git repository
    await execa('git', ['init']);
    await execa('git', ['config', 'user.email', 'test@test.com']);
    await execa('git', ['config', 'user.name', 'Test User']);
    await execa('git', ['config', 'commit.gpgsign', 'false']);

    // Create an initial commit (required for rover init to work)
    writeFileSync('README.md', '# Test Project\n');
    await execa('git', ['add', 'README.md']);
    await execa('git', ['commit', '-m', 'Initial commit']);
  });

  afterEach(() => {
    // Restore original state
    process.chdir(originalCwd);
    process.env.PATH = originalPath;
    rmSync(testDir, { recursive: true, force: true });
  });

  /**
   * Helper to run the rover CLI
   */
  const runRoverInit = async (args: string[] = ['--yes']) => {
    // Find the rover CLI binary (assuming it's built)
    const roverBin = join(__dirname, '../../../dist/index.js');

    // Prepend mock bin to PATH so our mocks are found FIRST
    // This allows us to override real system tools with our mocks
    const testPath = `${mockBinDir}:${originalPath}`;

    // Run rover init with the provided arguments
    return execa('node', [roverBin, 'init', ...args], {
      cwd: testDir,
      env: {
        // Mock bin is first in PATH, so our mocks take precedence
        PATH: testPath,
        HOME: process.env.HOME,
        USER: process.env.USER,
        TMPDIR: process.env.TMPDIR,
        // Disable telemetry for tests
        ROVER_TELEMETRY_DISABLED: '1',
      },
      reject: false, // Don't throw on non-zero exit
    });
  };

  describe('successful initialization', () => {
    it('should initialize a TypeScript project with all required tools available', async () => {
      // Setup: Create mock tools
      createMockTool('docker', 0, 'Docker version 24.0.0');
      createMockTool('claude', 0, 'Claude CLI v1.0.0');

      // Setup: Create TypeScript project files
      writeFileSync(
        'package.json',
        JSON.stringify(
          {
            name: 'test-project',
            version: '1.0.0',
            type: 'module',
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
              target: 'ES2022',
              module: 'ESNext',
            },
          },
          null,
          2
        )
      );
      writeFileSync('package-lock.json', '{}');

      // Execute: Run rover init
      const result = await runRoverInit(['--yes']);

      // Debug output if test fails
      if (result.exitCode !== 0) {
        console.log('STDOUT:', result.stdout);
        console.log('STDERR:', result.stderr);
      }

      // Verify: Command succeeded
      expect(result.exitCode).toBe(0);

      // Verify: rover.json was created with correct configuration
      expect(existsSync('rover.json')).toBe(true);
      const roverConfig = JSON.parse(readFileSync('rover.json', 'utf8'));
      expect(roverConfig.languages).toContain('typescript');
      expect(roverConfig.languages).toContain('javascript');
      expect(roverConfig.packageManagers).toContain('npm');

      // Verify: .rover/settings.json was created
      expect(existsSync('.rover/settings.json')).toBe(true);
      const settings = JSON.parse(readFileSync('.rover/settings.json', 'utf8'));
      expect(settings.aiAgents).toContain('claude');
      expect(settings.defaults.aiAgent).toBe('claude');

      // Verify: .gitignore was updated
      expect(existsSync('.gitignore')).toBe(true);
      const gitignore = readFileSync('.gitignore', 'utf8');
      expect(gitignore).toContain('.rover/');
    });

    it('should detect multiple AI agents and select the first one with --yes flag', async () => {
      // Setup: Create mock tools with multiple AI agents
      createMockTool('docker', 0, 'Docker version 24.0.0');
      createMockTool('claude', 0, 'Claude CLI v1.0.0');
      createMockTool('gemini', 0, 'Gemini CLI v1.0.0');
      createMockTool('codex', 0, 'Codex CLI v1.0.0');

      // Setup: Create minimal project
      writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

      // Execute: Run rover init
      const result = await runRoverInit(['--yes']);

      // Verify: Command succeeded
      expect(result.exitCode).toBe(0);

      // Verify: Settings contains all detected agents
      const settings = JSON.parse(readFileSync('.rover/settings.json', 'utf8'));
      expect(settings.aiAgents.length).toBeGreaterThan(1);
      expect(settings.aiAgents).toEqual(
        expect.arrayContaining(['claude', 'gemini', 'codex'])
      );

      // Verify: First available agent was selected as default
      expect(settings.defaults.aiAgent).toBeTruthy();
    });

    it('should detect Rust project correctly', async () => {
      // Setup: Create mock tools
      createMockTool('docker', 0, 'Docker version 24.0.0');
      createMockTool('qwen', 0, 'Qwen CLI v1.0.0');

      // Setup: Create Rust project files
      writeFileSync(
        'Cargo.toml',
        `
[package]
name = "test-project"
version = "0.1.0"
edition = "2021"
`
      );

      // Execute: Run rover init
      const result = await runRoverInit(['--yes']);

      // Verify: Command succeeded
      expect(result.exitCode).toBe(0);

      // Verify: Rust was detected
      const roverConfig = JSON.parse(readFileSync('rover.json', 'utf8'));
      expect(roverConfig.languages).toContain('rust');
      expect(roverConfig.packageManagers).toContain('cargo');
    });

    it('should detect Python project with uv package manager', async () => {
      // Setup: Create mock tools
      createMockTool('docker', 0, 'Docker version 24.0.0');
      createMockTool('gemini', 0, 'Gemini CLI v1.0.0');

      // Setup: Create Python project files
      writeFileSync(
        'pyproject.toml',
        `
[project]
name = "test-project"
version = "0.1.0"
`
      );
      writeFileSync('uv.lock', '# UV lock file');

      // Execute: Run rover init
      const result = await runRoverInit(['--yes']);

      // Verify: Command succeeded
      expect(result.exitCode).toBe(0);

      // Verify: Python and uv were detected
      const roverConfig = JSON.parse(readFileSync('rover.json', 'utf8'));
      expect(roverConfig.languages).toContain('python');
      expect(roverConfig.packageManagers).toContain('uv');
      // Should NOT detect pip or poetry when uv.lock is present
      expect(roverConfig.packageManagers).not.toContain('pip');
      expect(roverConfig.packageManagers).not.toContain('poetry');
    });

    it('should detect task managers (Make, Just, Task)', async () => {
      // Setup: Create mock tools
      createMockTool('docker', 0, 'Docker version 24.0.0');
      createMockTool('claude', 0, 'Claude CLI v1.0.0');

      // Setup: Create project with task managers
      writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));
      writeFileSync(
        'Makefile',
        `
all:
	echo "Building..."
`
      );
      writeFileSync(
        'Justfile',
        `
default:
	echo "Running..."
`
      );
      writeFileSync(
        'Taskfile.yml',
        `
version: '3'
tasks:
  default:
    cmds:
      - echo "Task running..."
`
      );

      // Execute: Run rover init
      const result = await runRoverInit(['--yes']);

      // Verify: Command succeeded
      expect(result.exitCode).toBe(0);

      // Verify: All task managers were detected
      const roverConfig = JSON.parse(readFileSync('rover.json', 'utf8'));
      expect(roverConfig.taskManagers).toContain('make');
      expect(roverConfig.taskManagers).toContain('just');
      expect(roverConfig.taskManagers).toContain('task');
    });

    it('should detect polyglot project with multiple languages', async () => {
      // Setup: Create mock tools
      createMockTool('docker', 0, 'Docker version 24.0.0');
      createMockTool('codex', 0, 'Codex CLI v1.0.0');

      // Setup: Create polyglot project
      writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));
      writeFileSync('package-lock.json', '{}'); // Required for npm detection
      writeFileSync('tsconfig.json', '{}');
      writeFileSync('Cargo.toml', '[package]\nname = "test"');
      writeFileSync('Cargo.lock', '{}'); // Good practice for cargo detection
      writeFileSync('go.mod', 'module test\n\ngo 1.21');
      writeFileSync('go.sum', ''); // Good practice for go detection
      writeFileSync('composer.json', '{"name": "test/test"}');
      writeFileSync('composer.lock', '{}'); // Required for composer detection

      // Execute: Run rover init
      const result = await runRoverInit(['--yes']);

      // Debug output if test fails
      if (result.exitCode !== 0) {
        console.log('Polyglot test STDOUT:', result.stdout);
        console.log('Polyglot test STDERR:', result.stderr);
      }

      // Verify: Command succeeded
      expect(result.exitCode).toBe(0);

      // Verify: All languages were detected
      const roverConfig = JSON.parse(readFileSync('rover.json', 'utf8'));
      expect(roverConfig.languages).toEqual(
        expect.arrayContaining([
          'typescript',
          'javascript',
          'rust',
          'go',
          'php',
        ])
      );
      expect(roverConfig.packageManagers).toEqual(
        expect.arrayContaining(['npm', 'cargo', 'gomod', 'composer'])
      );
    });

    it('should not reinitialize if already initialized', async () => {
      // Setup: Create mock tools
      createMockTool('docker', 0, 'Docker version 24.0.0');
      createMockTool('claude', 0, 'Claude CLI v1.0.0');

      // Setup: Create existing configuration
      writeFileSync(
        'rover.json',
        JSON.stringify(
          {
            version: '1',
            languages: ['typescript'],
            packageManagers: ['npm'],
            attribution: false,
          },
          null,
          2
        )
      );
      mkdirSync('.rover', { recursive: true });
      writeFileSync(
        '.rover/settings.json',
        JSON.stringify(
          {
            version: '1',
            aiAgents: ['claude'],
            defaults: { aiAgent: 'claude' },
          },
          null,
          2
        )
      );

      // Execute: Run rover init again
      const result = await runRoverInit(['--yes']);

      // Verify: Command detected existing initialization
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('already initialized');

      // Verify: Configuration was not overwritten
      const roverConfig = JSON.parse(readFileSync('rover.json', 'utf8'));
      expect(roverConfig.languages).toEqual(['typescript']);
    });

    it('should successfully re-initialize in a cloned repository with committed rover config', async () => {
      // Setup: Create mock tools
      createMockTool('docker', 0, 'Docker version 24.0.0');
      createMockTool('claude', 0, 'Claude CLI v1.0.0');

      // Step 1: Create a project with package.json and package-lock.json
      writeFileSync(
        'package.json',
        JSON.stringify(
          {
            name: 'test-project',
            version: '1.0.0',
            type: 'module',
          },
          null,
          2
        )
      );
      // Create package-lock.json to ensure npm is detected
      writeFileSync('package-lock.json', JSON.stringify({}, null, 2));

      // Step 2: Run rover init for the first time
      const initResult = await runRoverInit(['--yes']);
      expect(initResult.exitCode).toBe(0);

      // Verify rover was initialized
      expect(existsSync('rover.json')).toBe(true);
      expect(existsSync('.rover/settings.json')).toBe(true);
      expect(existsSync('.gitignore')).toBe(true);

      // Step 3: Commit the rover configuration
      await execa('git', ['add', '.'], { cwd: testDir });
      await execa('git', ['commit', '-m', 'Add rover configuration'], {
        cwd: testDir,
      });

      // Step 4: Clone the repository to a new directory
      const cloneDir = mkdtempSync(join(tmpdir(), 'rover-init-clone-'));
      await execa('git', ['clone', testDir, cloneDir]);

      // Step 5: Set up mock tools in the cloned directory
      const cloneMockBinDir = join(cloneDir, '.mock-bin');
      mkdirSync(cloneMockBinDir, { recursive: true });

      // Create mock tools in the clone's mock bin directory
      const createMockToolInClone = (
        toolName: string,
        exitCode: number = 0,
        output: string = 'mock version 1.0.0'
      ) => {
        const scriptPath = join(cloneMockBinDir, toolName);
        const scriptContent = `#!/usr/bin/env bash\necho "${output}"\nexit ${exitCode}`;
        writeFileSync(scriptPath, scriptContent);
        chmodSync(scriptPath, 0o755);
      };

      createMockToolInClone('docker', 0, 'Docker version 24.0.0');
      createMockToolInClone('claude', 0, 'Claude CLI v1.0.0');

      // Step 6: Run rover init in the cloned directory
      const roverBin = join(__dirname, '../../../dist/index.js');
      const clonePath = `${cloneMockBinDir}:${originalPath}`;

      const cloneInitResult = await execa('node', [roverBin, 'init', '--yes'], {
        cwd: cloneDir,
        env: {
          PATH: clonePath,
          HOME: process.env.HOME,
          USER: process.env.USER,
          TMPDIR: process.env.TMPDIR,
          ROVER_TELEMETRY_DISABLED: '1',
        },
        reject: false,
      });

      // Debug output if test fails
      if (cloneInitResult.exitCode !== 0) {
        console.log('Clone init STDOUT:', cloneInitResult.stdout);
        console.log('Clone init STDERR:', cloneInitResult.stderr);
      }

      // Step 7: Verify rover init succeeded in the cloned repo
      expect(cloneInitResult.exitCode).toBe(0);

      // Verify the cloned repo still has the rover configuration
      expect(existsSync(join(cloneDir, 'rover.json'))).toBe(true);
      expect(existsSync(join(cloneDir, '.rover/settings.json'))).toBe(true);

      // Verify the configuration is intact
      const clonedRoverConfig = JSON.parse(
        readFileSync(join(cloneDir, 'rover.json'), 'utf8')
      );
      expect(clonedRoverConfig.languages).toContain('javascript');
      expect(clonedRoverConfig.packageManagers).toContain('npm');

      const clonedSettings = JSON.parse(
        readFileSync(join(cloneDir, '.rover/settings.json'), 'utf8')
      );
      expect(clonedSettings.aiAgents).toContain('claude');
      expect(clonedSettings.defaults.aiAgent).toBe('claude');

      // Cleanup: Remove cloned directory
      rmSync(cloneDir, { recursive: true, force: true });
    });
  });

  describe('missing requirements', () => {
    it('should fail if Docker is not installed', async () => {
      // Setup: Create only AI agent, no Docker
      // Docker mock from beforeEach should remain as "failing" (exit 127)
      createMockTool('claude', 0, 'Claude CLI v1.0.0');

      // Setup: Create minimal project
      writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

      // Execute: Run rover init
      const result = await runRoverInit(['--yes']);

      // Debug output
      if (result.exitCode !== 1) {
        console.log('Docker test STDOUT:', result.stdout);
        console.log('Docker test exit code:', result.exitCode);
      }

      // Verify: Command failed
      expect(result.exitCode).toBe(1);
      expect(result.stdout || result.stderr).toMatch(
        /docker.*not found|docker.*required|docker.*missing/i
      );
    });

    it('should fail if no AI agent is installed', async () => {
      // Setup: Create only Docker, no AI agents
      // AI agent mocks from beforeEach should remain as "failing" (exit 127)
      createMockTool('docker', 0, 'Docker version 24.0.0');

      // Setup: Create minimal project
      writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

      // Execute: Run rover init
      const result = await runRoverInit(['--yes']);

      // Debug output
      if (result.exitCode !== 1) {
        console.log('AI agent test STDOUT:', result.stdout);
        console.log('AI agent test exit code:', result.exitCode);
      }

      // Verify: Command failed
      expect(result.exitCode).toBe(1);
      expect(result.stdout || result.stderr).toMatch(
        /ai agent.*not found|at least one ai agent|missing/i
      );
    });

    it('should fail if both Docker and AI agents are missing', async () => {
      // Setup: Create minimal project with no tools
      writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

      // Execute: Run rover init
      const result = await runRoverInit(['--yes']);

      // Verify: Command failed
      expect(result.exitCode).toBe(1);
      // Should mention both missing requirements
      const output = (result.stdout || result.stderr).toLowerCase();
      expect(output).toMatch(/docker|ai agent/);
    });
  });

  describe('.gitignore handling', () => {
    it('should create .gitignore if it does not exist', async () => {
      // Setup: Create mock tools
      createMockTool('docker', 0, 'Docker version 24.0.0');
      createMockTool('claude', 0, 'Claude CLI v1.0.0');

      // Setup: Create minimal project without .gitignore
      writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

      // Execute: Run rover init
      const result = await runRoverInit(['--yes']);

      // Verify: Command succeeded
      expect(result.exitCode).toBe(0);

      // Verify: .gitignore was created with .rover/ entry
      expect(existsSync('.gitignore')).toBe(true);
      const gitignore = readFileSync('.gitignore', 'utf8');
      expect(gitignore.trim()).toBe('.rover/');
    });

    it('should append to existing .gitignore', async () => {
      // Setup: Create mock tools
      createMockTool('docker', 0, 'Docker version 24.0.0');
      createMockTool('claude', 0, 'Claude CLI v1.0.0');

      // Setup: Create existing .gitignore
      writeFileSync('.gitignore', 'node_modules/\n.env\n');
      writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

      // Execute: Run rover init
      const result = await runRoverInit(['--yes']);

      // Verify: Command succeeded
      expect(result.exitCode).toBe(0);

      // Verify: .gitignore was appended to
      const gitignore = readFileSync('.gitignore', 'utf8');
      expect(gitignore).toContain('node_modules/');
      expect(gitignore).toContain('.env');
      expect(gitignore).toContain('.rover/');
    });

    it('should not duplicate .rover/ entry in .gitignore', async () => {
      // Setup: Create mock tools
      createMockTool('docker', 0, 'Docker version 24.0.0');
      createMockTool('claude', 0, 'Claude CLI v1.0.0');

      // Setup: Create .gitignore with .rover/ already present
      writeFileSync('.gitignore', 'node_modules/\n.rover/\n.env\n');
      writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

      // Execute: Run rover init
      const result = await runRoverInit(['--yes']);

      // Verify: Command succeeded
      expect(result.exitCode).toBe(0);

      // Verify: .rover/ entry was not duplicated
      const gitignore = readFileSync('.gitignore', 'utf8');
      const roverEntries = gitignore
        .split('\n')
        .filter(line => line.trim() === '.rover/');
      expect(roverEntries.length).toBe(1);
    });
  });

  describe('tool mocking capabilities', () => {
    it('should detect different AI agents based on which mock tools are available', async () => {
      // Setup: Create Docker and Gemini only
      createMockTool('docker', 0, 'Docker version 24.0.0');
      createMockTool('gemini', 0, 'Gemini CLI v1.0.0');

      writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

      // Execute
      const result = await runRoverInit(['--yes']);

      // Verify: Only Gemini was detected
      expect(result.exitCode).toBe(0);
      const settings = JSON.parse(readFileSync('.rover/settings.json', 'utf8'));
      expect(settings.aiAgents).toContain('gemini');
      expect(settings.aiAgents).not.toContain('claude');
      expect(settings.aiAgents).not.toContain('codex');
      expect(settings.defaults.aiAgent).toBe('gemini');
    });

    it('should handle failing tool checks gracefully', async () => {
      // Setup: Create Docker that exits with error, but Claude that works
      createMockTool('docker', 1, 'Docker command failed'); // Exit code 1
      createMockTool('claude', 0, 'Claude CLI v1.0.0');

      writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

      // Execute
      const result = await runRoverInit(['--yes']);

      // Verify: Should fail because Docker is required
      expect(result.exitCode).toBe(1);
    });

    it('should work with any combination of AI agents', async () => {
      // Setup: Test with Codex and Qwen only
      createMockTool('docker', 0, 'Docker version 24.0.0');
      createMockTool('codex', 0, 'Codex CLI v1.0.0');
      createMockTool('qwen', 0, 'Qwen CLI v1.0.0');

      writeFileSync('package.json', JSON.stringify({ name: 'test' }, null, 2));

      // Execute
      const result = await runRoverInit(['--yes']);

      // Verify: Both Codex and Qwen were detected
      expect(result.exitCode).toBe(0);
      const settings = JSON.parse(readFileSync('.rover/settings.json', 'utf8'));
      expect(settings.aiAgents).toEqual(
        expect.arrayContaining(['codex', 'qwen'])
      );
      expect(settings.aiAgents).not.toContain('claude');
      expect(settings.aiAgents).not.toContain('gemini');
    });
  });
});
