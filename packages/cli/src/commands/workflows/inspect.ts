/**
 * Inspect a specific workflow by name showing detailed information.
 */
import colors from 'ansi-colors';
import { initWorkflowStore } from '../../lib/workflow.js';
import {
  showTitle,
  showProperties,
  showDiagram,
  WorkflowManager,
  type DiagramStep,
} from 'rover-core';
import type { WorkflowOutput } from 'rover-schemas';
import {
  readFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { getTelemetry } from '../../lib/telemetry.js';
import { getProjectPath, isJsonMode, setJsonMode } from '../../lib/context.js';
import { readFromStdin } from '../../utils/stdin.js';
import type { CommandDefinition } from '../../types.js';

interface InspectWorkflowCommandOptions {
  // Output formats
  json: boolean;
  raw: boolean;
}

/**
 * Determine the type of workflow source input
 */
function detectSourceType(source: string): 'http' | 'file' | 'name' {
  // Check for HTTP/HTTPS URL
  if (source.startsWith('http://') || source.startsWith('https://')) {
    return 'http';
  }

  // Check for file path (absolute or relative with extension)
  if (
    source.includes('/') ||
    source.includes('\\') ||
    source.endsWith('.yml') ||
    source.endsWith('.yaml')
  ) {
    return 'file';
  }

  // Default to workflow name
  return 'name';
}

/**
 * Fetch workflow content from HTTP URL
 */
async function fetchWorkflowFromUrl(url: string): Promise<string> {
  // Validate URL
  let urlObj: URL;
  try {
    urlObj = new URL(url);
  } catch (error) {
    throw new Error('Invalid URL format');
  }

  if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are supported');
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Check content length
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
      throw new Error('Workflow file too large (max 10MB)');
    }

    const content = await response.text();

    if (!content || content.trim().length === 0) {
      throw new Error('Empty response from URL');
    }

    return content;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout: Failed to fetch workflow from URL');
      }
      throw new Error(`Failed to fetch workflow from URL: ${error.message}`);
    }
    throw new Error(`Failed to fetch workflow from URL: ${error}`);
  }
}

/**
 * Create a temporary file with workflow content
 */
function createTempWorkflowFile(content: string): string {
  try {
    const tempDir = mkdtempSync(join(tmpdir(), 'rover-workflow-'));
    const tempFile = join(tempDir, 'workflow.yml');
    writeFileSync(tempFile, content, 'utf-8');
    return tempFile;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to create temporary file: ${error.message}`);
    }
    throw new Error(`Failed to create temporary file: ${error}`);
  }
}

/**
 * Clean up temporary directory
 */
function cleanupTempFile(filePath: string): void {
  try {
    // Remove the parent directory (the temp directory)
    const tempDir = dirname(filePath);
    rmSync(tempDir, { recursive: true, force: true });
  } catch (error) {
    // Silently fail cleanup - not critical
  }
}

/**
 * Inspect a specific workflow showing detailed information.
 *
 * @param workflowSource Name, URL, or file path of the workflow to inspect
 * @param options Options to modify the output
 */
const inspectWorkflowCommand = async (
  workflowSource: string,
  options: InspectWorkflowCommandOptions
) => {
  const telemetry = getTelemetry();
  if (options.json !== undefined) {
    setJsonMode(options.json);
  }

  let tempFile: string | null = null;

  try {
    // Track inspect workflow event
    telemetry?.eventInspectWorkflow();

    // Handle stdin input when source is '-'
    if (workflowSource === '-') {
      const stdinContent = await readFromStdin();
      if (!stdinContent) {
        const errorMsg = 'No input provided on stdin';
        if (isJsonMode()) {
          console.log(
            JSON.stringify(
              {
                success: false,
                error: errorMsg,
              },
              null,
              2
            )
          );
        } else if (options.raw) {
          console.error(`Error: ${errorMsg}`);
        } else {
          console.log(colors.red(`✗ ${errorMsg}`));
        }
        return;
      }

      // Create temporary file for stdin content
      tempFile = createTempWorkflowFile(stdinContent);
      workflowSource = tempFile;
    }

    // Detect the type of source
    const sourceType = detectSourceType(workflowSource);
    let workflow: WorkflowManager | undefined;
    let sourceOrigin: string;

    // Load workflow based on source type
    if (sourceType === 'http') {
      // Fetch from HTTP URL
      try {
        const content = await fetchWorkflowFromUrl(workflowSource);
        tempFile = createTempWorkflowFile(content);
        workflow = WorkflowManager.load(tempFile);
        sourceOrigin = workflowSource;
      } catch (error) {
        if (isJsonMode()) {
          console.log(
            JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            )
          );
        } else if (options.raw) {
          console.error(
            `Error: ${error instanceof Error ? error.message : error}`
          );
        } else {
          console.log(
            colors.red(`✗ ${error instanceof Error ? error.message : error}`)
          );
        }
        return;
      }
    } else if (sourceType === 'file') {
      // Load from file path
      try {
        if (!existsSync(workflowSource)) {
          throw new Error(`File not found: ${workflowSource}`);
        }
        workflow = WorkflowManager.load(workflowSource);
        // Set source origin to 'stdin' if it was read from stdin, otherwise use file path
        sourceOrigin = tempFile !== null ? 'stdin' : workflowSource;
      } catch (error) {
        if (isJsonMode()) {
          console.log(
            JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            )
          );
        } else if (options.raw) {
          console.error(
            `Error: ${error instanceof Error ? error.message : error}`
          );
        } else {
          console.log(
            colors.red(`✗ ${error instanceof Error ? error.message : error}`)
          );
        }
        return;
      }
    } else {
      // Load by workflow name
      const workflowStore = initWorkflowStore(
        getProjectPath() ?? process.cwd()
      );
      const entry = workflowStore.getWorkflowEntry(workflowSource);

      if (!entry) {
        if (isJsonMode()) {
          console.log(
            JSON.stringify(
              {
                success: false,
                error: `Workflow "${workflowSource}" not found`,
              },
              null,
              2
            )
          );
        } else if (options.raw) {
          console.error(`Error: Workflow "${workflowSource}" not found`);
        } else {
          console.log(colors.red(`✗ Workflow "${workflowSource}" not found`));
          console.log(
            colors.gray('\nUse ') +
              colors.cyan('rover workflows list') +
              colors.gray(' to see available workflows')
          );
        }
        return;
      }
      workflow = entry.workflow;
      sourceOrigin = entry.source;
    }

    // Handle --raw flag: output workflow as YAML
    if (options.raw) {
      // Read the file directly. There's an issue with the toYaml method.
      // It adds extra breaklines in the prompts.
      // @see https://github.com/eemeli/yaml/issues/639#issuecomment-3381575231
      console.log(readFileSync(workflow.filePath, 'utf-8'));
      return;
    }

    // Handle --json flag: output workflow as JSON
    if (isJsonMode()) {
      console.log(
        JSON.stringify(
          {
            success: true,
            workflow: workflow.toObject(),
            source: sourceOrigin,
          },
          null,
          2
        )
      );
      return;
    }

    // Regular output mode: formatted display
    showTitle('Workflow Details');

    // Display basic metadata
    const properties: Record<string, string> = {
      Name: workflow.name,
      Description: workflow.description || colors.gray('No description'),
      Version: workflow.version,
      Source: sourceOrigin,
    };

    // Add defaults if present
    if (workflow.defaults) {
      if (workflow.defaults.tool) {
        properties['Default Tool'] = workflow.defaults.tool;
      }
      if (workflow.defaults.model) {
        properties['Default Model'] = workflow.defaults.model;
      }
    }

    // Add config if present
    if (workflow.config) {
      if (workflow.config.timeout) {
        properties['Timeout'] = `${workflow.config.timeout}s`;
      }
      if (workflow.config.continueOnError !== undefined) {
        properties['Continue On Error'] = workflow.config.continueOnError
          ? 'Yes'
          : 'No';
      }
    }

    showProperties(properties);

    // Display inputs
    if (workflow.inputs.length > 0) {
      showTitle('Inputs');
      const inputProperties: Record<string, string> = {};
      workflow.inputs.forEach(input => {
        const parts: string[] = [];

        if (input.description) {
          parts.push(input.description);
        }

        const details: string[] = [];
        if (input.required) {
          details.push(colors.red('required'));
        }
        if (input.default) {
          details.push(colors.gray(`default: ${input.default}`));
        }

        if (details.length > 0) {
          parts.push(`(${details.join(', ')})`);
        }

        inputProperties[input.name] =
          parts.join(' ') || colors.gray('No description');
      });
      showProperties(inputProperties);
    }

    // Display outputs
    if (workflow.outputs.length > 0) {
      showTitle('Outputs');
      const outputProperties: Record<string, string> = {};
      workflow.outputs.forEach(output => {
        outputProperties[output.name] =
          output.description || colors.gray('No description');
      });
      showProperties(outputProperties);
    }

    // Display steps as a visual diagram
    if (workflow.steps.length > 0) {
      showTitle('Steps');

      const diagramSteps: DiagramStep[] = workflow.steps.map(step => {
        const items: string[] = [];

        // Add outputs if present
        if (step.outputs && step.outputs.length > 0) {
          step.outputs.forEach((output: WorkflowOutput) => {
            items.push(`${colors.cyan('→')} ${output.name}`);
          });
        }

        return {
          title: step.name,
          items,
        };
      });

      showDiagram(diagramSteps, { addLineBreak: false });
    }
  } catch (error) {
    if (isJsonMode()) {
      console.log(
        JSON.stringify(
          {
            success: false,
            error: `Error inspecting workflow: ${error}`,
          },
          null,
          2
        )
      );
    } else if (options.raw) {
      console.error(`Error inspecting workflow: ${error}`);
    } else {
      console.error(colors.red('Error inspecting workflow:'), error);
    }
  } finally {
    // Clean up temporary file if it was created
    if (tempFile) {
      cleanupTempFile(tempFile);
    }
    await telemetry?.shutdown();
  }
};

// Named export for backwards compatibility (used by tests)
export { inspectWorkflowCommand };

export default {
  name: 'inspect',
  parent: 'workflows',
  description: 'Display detailed information about a specific workflow',
  requireProject: false,
  action: inspectWorkflowCommand,
} satisfies CommandDefinition;
