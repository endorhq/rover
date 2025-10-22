/**
 * Workflow loader for parsing and validating workflow YAML files
 */

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ZodError } from 'zod';
import { WorkflowSchema } from './schema.js';
import type { Workflow } from './types.js';

/**
 * Error class for workflow loading errors
 */
export class WorkflowLoadError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'WorkflowLoadError';
  }
}

/**
 * Error class for workflow validation errors
 */
export class WorkflowValidationError extends Error {
  constructor(
    message: string,
    public readonly validationErrors: ZodError
  ) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

/**
 * Parse YAML content into a workflow object
 */
function parseWorkflowYaml(content: string): unknown {
  try {
    return parseYaml(content);
  } catch (error) {
    throw new WorkflowLoadError(
      `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Validate parsed workflow object against schema
 */
function validateWorkflow(data: unknown): Workflow {
  try {
    // Parse and cast to Workflow type since we know the schema validates all fields
    const validated = WorkflowSchema.parse(data);
    return validated as Workflow;
  } catch (error) {
    if (error instanceof ZodError) {
      const errorMessages = error.issues
        .map(err => `  - ${err.path.join('.')}: ${err.message}`)
        .join('\n');
      throw new WorkflowValidationError(
        `Workflow validation failed:\n${errorMessages}`,
        error
      );
    }
    throw new WorkflowLoadError(
      `Unexpected validation error: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }
}

/**
 * Load and validate a workflow from a YAML file
 *
 * @param filePath - Path to the workflow YAML file
 * @returns Validated workflow object
 * @throws {WorkflowLoadError} If the file cannot be read or parsed
 * @throws {WorkflowValidationError} If the workflow fails schema validation
 *
 * @example
 * ```typescript
 * import { loadWorkflow } from 'rover-common';
 *
 * try {
 *   const workflow = loadWorkflow('./workflows/swe.yml');
 *   console.log(`Loaded workflow: ${workflow.name}`);
 * } catch (error) {
 *   if (error instanceof WorkflowValidationError) {
 *     console.error('Validation errors:', error.validationErrors);
 *   } else {
 *     console.error('Failed to load workflow:', error);
 *   }
 * }
 * ```
 */
export function loadWorkflow(filePath: string): Workflow {
  let content: string;

  // Read file
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (error) {
    throw new WorkflowLoadError(
      `Failed to read workflow file at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      error
    );
  }

  // Parse YAML
  const parsed = parseWorkflowYaml(content);

  // Validate against schema
  return validateWorkflow(parsed);
}

/**
 * Load and validate a workflow from a YAML string
 *
 * @param yamlContent - YAML string containing the workflow definition
 * @returns Validated workflow object
 * @throws {WorkflowLoadError} If the YAML cannot be parsed
 * @throws {WorkflowValidationError} If the workflow fails schema validation
 *
 * @example
 * ```typescript
 * import { loadWorkflowFromString } from 'rover-common';
 *
 * const yamlContent = `
 * version: '1.0'
 * name: 'test'
 * description: 'Test workflow'
 * steps:
 *   - id: step1
 *     type: agent
 *     name: 'Step 1'
 *     prompt: 'Do something'
 * `;
 *
 * const workflow = loadWorkflowFromString(yamlContent);
 * ```
 */
export function loadWorkflowFromString(yamlContent: string): Workflow {
  // Parse YAML
  const parsed = parseWorkflowYaml(yamlContent);

  // Validate against schema
  return validateWorkflow(parsed);
}
