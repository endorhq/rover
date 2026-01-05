/**
 * Add a workflow from a URL or local path to the workflow store.
 */
import colors from 'ansi-colors';
import { WorkflowStoreManager, WorkflowStoreManagerError } from 'rover-core';
import { CLIJsonOutput } from '../../types.js';
import { exitWithError, exitWithSuccess } from '../../utils/exit.js';
import { getTelemetry } from '../../lib/telemetry.js';
import { isJsonMode, setJsonMode } from '../../lib/global-state.js';

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
    store: 'local' | 'central';
  };
}

/**
 * Add a workflow from a URL or local path.
 *
 * @param source The URL or local path to the workflow
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

  try {
    const manager = new WorkflowStoreManager();

    // Track add workflow event
    telemetry?.eventAddWorkflow();

    // Add the workflow
    const result = await manager.add(source, options.name);

    // Prepare output
    output.success = true;
    output.workflow = {
      name: result.name,
      path: result.path,
      store: result.isLocal ? 'local' : 'central',
    };

    if (isJsonMode()) {
      await exitWithSuccess('', output, { telemetry });
    } else {
      // Format human-readable output
      const storeType = result.isLocal
        ? colors.cyan('local')
        : colors.cyan('central');
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
    await telemetry?.shutdown();
  }
};
