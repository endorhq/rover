import colors from 'ansi-colors';
import { existsSync } from 'node:fs';
import { launch, launchSync } from 'rover-common';
import yoctoSpinner from 'yocto-spinner';
import { statusColor } from '../utils/task-status.js';
import { TaskDescription, TaskNotFoundError } from '../lib/description.js';
import { getTelemetry } from '../lib/telemetry.js';
import { CLIJsonOutput } from '../types.js';
import { exitWithError, exitWithSuccess, exitWithWarn } from '../utils/exit.js';
import { DockerSandbox } from '../lib/sandbox/index.js';

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
    exitWithError(jsonOutput, json);
    return;
  }

  try {
    // Load task using TaskDescription
    const task = TaskDescription.load(numericTaskId);

    const colorFunc = statusColor(task.status);

    console.log(colors.bold('Task details'));
    console.log(colors.gray('├── ID: ') + colors.cyan(task.id.toString()));
    console.log(colors.gray('├── Title: ') + task.title);
    console.log(colors.gray('└── Status: ') + colorFunc(task.status) + '\n');

    // Check if worktree exists
    if (!task.worktreePath || !existsSync(task.worktreePath)) {
      jsonOutput.error = `No worktree found for this task`;
      exitWithError(jsonOutput, json);
      return;
    }

    telemetry?.eventShell();

    if (options.container) {
      // Check if Docker is available using the sandbox's availability check
      const dockerSandbox = new DockerSandbox(task);
      const isAvailable = await dockerSandbox.isBackendAvailable();

      if (!isAvailable) {
        jsonOutput.error = `Docker is not available. Please install it.`;
        exitWithError(jsonOutput, json);
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
        const dockerSandbox = new DockerSandbox(task);

        spinner.success('Shell started');

        // Use the DockerSandbox implementation to open shell at worktree
        await dockerSandbox.openShellAtWorktree();

        shellProcess = { exitCode: 0 };
      } catch (error) {
        spinner.error('Failed to start container shell');
        jsonOutput.error = 'Failed to start container: ' + error;
        exitWithError(jsonOutput, json);
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
        exitWithError(jsonOutput, json);
        return;
      }
    }

    if (shellProcess) {
      // Handle process completion
      if (shellProcess.exitCode === 0) {
        exitWithSuccess('Shell session ended', jsonOutput, json);
      } else {
        exitWithWarn(
          `Shell session ended with code ${shellProcess.exitCode}`,
          jsonOutput,
          json
        );
      }
    }
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      jsonOutput.error = `The task with ID ${numericTaskId} was not found`;
      exitWithError(jsonOutput, json);
    } else {
      jsonOutput.error = `There was an error starting the shell: ${error}`;
      exitWithError(jsonOutput, json);
    }
  } finally {
    await telemetry?.shutdown();
  }
};
