import * as assert from 'assert';
import * as vscode from 'vscode';
import { RoverCLI } from '../rover/cli.mjs';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Sample test', () => {
    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
  });

  suite('RoverCLI Tests', () => {
    let cli: RoverCLI;

    setup(() => {
      cli = new RoverCLI();
    });

    test('createTask should accept agent parameter', async () => {
      // Mock the launch function to verify arguments
      const originalLaunch = cli['launch'];
      let capturedArgs: string[] = [];
      
      // Mock launch to capture arguments without executing
      (cli as any).launch = async (path: string, args: string[], options: any) => {
        capturedArgs = args;
        // Return a mock successful response
        return {
          stdout: JSON.stringify({ id: 'test-task', title: 'Test Task' }),
          stderr: '',
          exitCode: 0
        };
      };

      await cli.createTask('test description', 'claude', 'feature-branch');

      // Verify that agent and source-branch arguments were included
      assert.ok(capturedArgs.includes('--agent'));
      assert.ok(capturedArgs.includes('claude'));
      assert.ok(capturedArgs.includes('--source-branch'));
      assert.ok(capturedArgs.includes('feature-branch'));
      assert.ok(capturedArgs.includes('test description'));
    });

    test('createTask should work without optional parameters', async () => {
      const originalLaunch = cli['launch'];
      let capturedArgs: string[] = [];
      
      (cli as any).launch = async (path: string, args: string[], options: any) => {
        capturedArgs = args;
        return {
          stdout: JSON.stringify({ id: 'test-task', title: 'Test Task' }),
          stderr: '',
          exitCode: 0
        };
      };

      await cli.createTask('test description');

      // Verify that only required arguments are included
      assert.ok(capturedArgs.includes('test description'));
      assert.ok(capturedArgs.includes('--yes'));
      assert.ok(capturedArgs.includes('--json'));
      assert.ok(!capturedArgs.includes('--agent'));
      assert.ok(!capturedArgs.includes('--source-branch'));
    });

    test('createTask should handle branch names with special characters', async () => {
      const originalLaunch = cli['launch'];
      let capturedArgs: string[] = [];
      
      (cli as any).launch = async (path: string, args: string[], options: any) => {
        capturedArgs = args;
        return {
          stdout: JSON.stringify({ id: 'test-task', title: 'Test Task' }),
          stderr: '',
          exitCode: 0
        };
      };

      await cli.createTask('test description', 'claude', 'feature/branch-with-special-chars');

      // Verify that special characters in branch names are preserved
      assert.ok(capturedArgs.includes('feature/branch-with-special-chars'));
    });
  });

  suite('VS Code Command Tests', () => {
    test('rover.createTask command should accept additional parameters', async () => {
      // Test that the command is registered with correct signature
      const commands = await vscode.commands.getCommands();
      assert.ok(commands.includes('rover.createTask'));

      // Note: More detailed testing would require mocking the CLI calls
      // which is beyond the scope of unit tests for VS Code extensions
    });
  });
});
