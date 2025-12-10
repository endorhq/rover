import colors from 'ansi-colors';
import { existsSync } from 'node:fs';
import { launch, launchSync } from 'rover-core';
import yoctoSpinner from 'yocto-spinner';
import { statusColor } from '../utils/task-status.js';
import { TaskDescriptionManager, TaskNotFoundError } from 'rover-schemas';
import { getTelemetry } from '../lib/telemetry.js';
import { CLIJsonOutput } from '../types.js';
import { exitWithError, exitWithSuccess, exitWithWarn } from '../utils/exit.js';
import { isJsonMode, setJsonMode } from '../lib/global-state.js';
import {
  createSandbox,
  getAvailableSandboxBackend,
} from '../lib/sandbox/index.js';

/**
 * Start an interactive shell for testing task changes
 */
export const shellCommand = async (
  taskId: string,
  options: { container?: boolean }
) => {
  const telemetry = getTelemetry();

  // Add the JSON flag to use some utilities. However, this command is interactive
  // so it is always false.
  const json = false;
  // Fake JSON output
  const jsonOutput: CLIJsonOutput = { success: false };

  // Convert string taskId to number
  const numericTaskId = parseInt(taskId, 10);
  if (isNaN(numericTaskId)) {
    jsonOutput.error = `Invalid task ID '${taskId}' - must be a number`;
    await exitWithError(jsonOutput, { telemetry });
    return;
  }

  try {
    // Load task using TaskDescription
    const task = TaskDescriptionManager.load(numericTaskId);

    const colorFunc = statusColor(task.status);

    console.log(colors.bold('Task details'));
    console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
    console.log(colors.gray('├── Title: ') + task.title);
    console.log(colors.gray('└── Status: ') + colorFunc(task.status) + '\n');

    // Check if worktree exists
    if (!task.worktreePath || !existsSync(task.worktreePath)) {
      jsonOutput.error = `No worktree found for this task`;
      await exitWithError(jsonOutput, { telemetry });
      return;
    }

    telemetry?.eventShell();

    if (options.container) {
      // Check if any sandbox backend (Docker or Podman) is available
      const availableBackend = await getAvailableSandboxBackend();

      if (!availableBackend) {
        jsonOutput.error = `Neither Docker nor Podman are available. Please install Docker or Podman.`;
        await exitWithError(jsonOutput, { telemetry });
        return;
      }
    }

    console.log(
      colors.green('✓ Starting interactive shell in the task workspace')
    );
    console.log(
      colors.gray('Type') +
        colors.cyan(' "exit" ') +
        colors.gray('to leave the shell')
    );
    console.log('');

    const spinner = yoctoSpinner({ text: 'Starting shell...' }).start();

    let shellProcess;

    if (options.container) {
      try {
        const sandbox = await createSandbox(task);

        spinner.success('Shell started');

        // Use the sandbox implementation to open shell at worktree
        await sandbox.openShellAtWorktree();

        shellProcess = { exitCode: 0 };
      } catch (error) {
        spinner.error('Failed to start container shell');
        jsonOutput.error = 'Failed to start container: ' + error;
        await exitWithError(jsonOutput, { telemetry });
        return;
      }
    } else {
      // Detect the appropriate shell based on the platform
      let shell: string;
      let shellArgs: string[] = [];

      if (process.platform === 'win32') {
        // On Windows, prioritize WSL, then fall back to PowerShell or cmd.exe
        shell = process.env.COMSPEC || 'cmd.exe';

        try {
          // Try WSL first (assume it exists)
          launchSync('wsl.exe', ['--version']);
          shell = 'wsl.exe';
          shellArgs = ['--cd', task.worktreePath];
        } catch {
          // WSL not available, try PowerShell if available
          if (process.env.PSModulePath) {
            // PowerShell is available
            const pwshPath = 'pwsh.exe'; // PowerShell Core
            const powershellPath = 'powershell.exe'; // Windows PowerShell

            try {
              // Try PowerShell Core first
              launchSync(pwshPath, ['-v']);
              shell = pwshPath;
              shellArgs = [
                '-NoExit',
                '-Command',
                `Set-Location '${task.worktreePath}'`,
              ];
            } catch {
              try {
                // Fall back to Windows PowerShell
                launchSync(powershellPath, ['-v']);
                shell = powershellPath;
                shellArgs = [
                  '-NoExit',
                  '-Command',
                  `Set-Location '${task.worktreePath}'`,
                ];
              } catch {
                // Fall back to cmd.exe - don't pass cd command, rely on cwd option instead
                shellArgs = ['/K'];
              }
            }
          } else {
            // Use cmd.exe - don't pass cd command, rely on cwd option instead
            shellArgs = ['/K'];
          }
        }
      } else {
        // Unix-like systems (Linux, macOS)
        shell = process.env.SHELL || '/bin/sh';
        shellArgs = [];
      }

      try {
        const shellInit = launch(shell, shellArgs, {
          stdio: 'inherit',
          cwd: task.worktreePath,
          reject: false,
        });

        spinner.success(`Shell started using ${shell}`);

        // Await for the process to complete
        shellProcess = await shellInit;
      } catch (error) {
        spinner.error(`Failed to start shell ${shell}`);
        jsonOutput.error = 'Failed to start shell: ' + error;
        await exitWithError(jsonOutput, { telemetry });
        return;
      }
    }

    if (shellProcess) {
      // Handle process completion
      if (shellProcess.exitCode === 0) {
        await exitWithSuccess('Shell session ended', jsonOutput, {
          telemetry,
        });
      } else {
        await exitWithWarn(
          `Shell session ended with code ${shellProcess.exitCode}`,
          jsonOutput,
          { telemetry }
        );
      }
    }
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      jsonOutput.error = `The task with ID ${numericTaskId} was not found`;
      await exitWithError(jsonOutput, { telemetry });
    } else {
      jsonOutput.error = `There was an error starting the shell: ${error}`;
      await exitWithError(jsonOutput, { telemetry });
    }
  } finally {
    await telemetry?.shutdown();
  }
};
