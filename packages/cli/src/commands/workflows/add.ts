/**
 * Add a workflow from a URL or local path to the workflow store.
 */
import colors from 'ansi-colors';
import { WorkflowStoreManager, WorkflowStoreManagerError } from 'rover-core';
import { CLIJsonOutput } from '../../types.js';
import { exitWithError, exitWithSuccess } from '../../utils/exit.js';
import { getTelemetry } from '../../lib/telemetry.js';
import { isJsonMode, setJsonMode } from '../../lib/global-state.js';
import { readFromStdin } from '../../utils/stdin.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';

interface AddWorkflowCommandOptions {
  // Custom name for the workflow
  name?: string;
  // Output format
  json: boolean;
}

/**
 * Interface for JSON output
 */
interface AddWorkflowOutput extends CLIJsonOutput {
  workflow?: {
    name: string;
    path: string;
    store: 'local' | 'global';
  };
}

/**
 * Add a workflow from a URL or local path.
 *
 * @param source The URL, local path, or '-' for stdin
 * @param options Options to modify the behavior
 */
export const addWorkflowCommand = async (
  source: string,
  options: AddWorkflowCommandOptions
) => {
  const telemetry = getTelemetry();
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

  const output: AddWorkflowOutput = {
    success: false,
  };

  let tempDir: string | null = null;
  let actualSource = source;

  try {
    // Handle stdin input when source is '-'
    if (source === '-') {
      const stdinContent = await readFromStdin();
      if (!stdinContent) {
        output.error = 'No input provided on stdin';
        await exitWithError(output, { telemetry });
        return;
      }

      // Create temporary file for stdin content
      tempDir = mkdtempSync(join(tmpdir(), 'rover-workflow-stdin-'));
      const tempFile = join(tempDir, 'workflow.yml');
      writeFileSync(tempFile, stdinContent, 'utf8');
      actualSource = tempFile;
    }

    const manager = new WorkflowStoreManager();

    // Track add workflow event
    telemetry?.eventAddWorkflow();

    // Add the workflow
    const result = await manager.add(actualSource, options.name);

    // Prepare output
    output.success = true;
    output.workflow = {
      name: result.name,
      path: result.path,
      store: result.isLocal ? 'local' : 'global',
    };

    if (isJsonMode()) {
      await exitWithSuccess('', output, { telemetry });
    } else {
      // Format human-readable output
      const storeType = result.isLocal
        ? colors.cyan('local')
        : colors.cyan('global');
      const workflowName = colors.bold(result.name);
      const storePath = colors.gray(result.path);

      const message = [
        `${colors.green('✓')} Workflow ${workflowName} added to ${storeType} store`,
        `  ${storePath}`,
      ].join('\n');

      await exitWithSuccess(message, output, { telemetry });
    }
  } catch (error) {
    if (error instanceof WorkflowStoreManagerError) {
      output.error = error.message;
    } else {
      output.error = 'Failed to add workflow.';
    }
    await exitWithError(output, { telemetry });
  } finally {
    // Clean up temporary directory if created
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
    await telemetry?.shutdown();
  }
};
