/**
 * Workflow configuration loader and processor for agent workflows.
 * Handles loading, validating, and managing YAML-based agent workflow definitions.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ZodError } from 'zod';
import {
  CURRENT_WORKFLOW_SCHEMA_VERSION,
  WorkflowSchema,
} from './workflow/schema.js';
import type {
  Workflow,
  WorkflowInput,
  WorkflowOutput,
  WorkflowStep,
  AgentStep,
  WorkflowDefaults,
  WorkflowConfig,
  AgentTool,
} from './workflow/types.js';
import {
  WorkflowLoadError,
  WorkflowValidationError,
} from './workflow/loader.js';
import { isAgentStep } from './workflow/types.js';

// Default step timeout in seconds
const DEFAULT_STEP_TIMEOUT = 60 * 30; // 30 minutes

/**
 * Workflow configuration class for loading and managing agent workflow definitions.
 * Provides validation, loading, and execution preparation for YAML-based workflows.
 */
export class AgentWorkflow {
  private data: Workflow;
  filePath: string;

  constructor(data: unknown, filePath: string) {
    try {
      // Validate data with Zod schema
      this.data = WorkflowSchema.parse(data);
      this.filePath = filePath;
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
      throw error;
    }
  }

  /**
   * Create a new workflow configuration from scratch
   */
  static create(
    filePath: string,
    name: string,
    description: string,
    inputs: WorkflowInput[] = [],
    outputs: WorkflowOutput[] = [],
    steps: WorkflowStep[] = []
  ): AgentWorkflow {
    const workflowData = {
      version: CURRENT_WORKFLOW_SCHEMA_VERSION,
      name,
      description,
      inputs,
      outputs,
      defaults: {
        tool: 'claude' as AgentTool,
        model: 'claude-4-sonnet',
      },
      config: {
        timeout: 3600, // 1 hour default
        continueOnError: false,
      },
      steps,
    };

    const instance = new AgentWorkflow(workflowData, filePath);
    instance.save();
    return instance;
  }

  /**
   * Load an existing workflow configuration from YAML file
   */
  static load(filePath: string): AgentWorkflow {
    if (!existsSync(filePath)) {
      throw new WorkflowLoadError(
        `Workflow configuration not found at ${filePath}`
      );
    }

    try {
      const rawData = readFileSync(filePath, 'utf8');
      const parsedData = parseYaml(rawData);
      const originalVersion = (parsedData as { version?: string }).version;

      // Migrate if necessary (returns validated Workflow)
      const migratedData = AgentWorkflow.migrate(parsedData);

      // Constructor validates with Zod (safe even though migrate already validated)
      const instance = new AgentWorkflow(migratedData, filePath);

      // If migration occurred, save the updated data
      if (migratedData.version !== originalVersion) {
        instance.save();
      }

      return instance;
    } catch (error) {
      // Re-throw validation errors as-is
      if (error instanceof WorkflowValidationError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new WorkflowLoadError(
          `Failed to load workflow config: ${error.message}`,
          error
        );
      }
      throw new WorkflowLoadError(`Failed to load workflow config: ${error}`);
    }
  }

  /**
   * Migrate old workflow schema to current version
   * Returns validated Workflow after migration
   */
  private static migrate(data: any): Workflow {
    // If already current version, validate and return
    if (data.version === CURRENT_WORKFLOW_SCHEMA_VERSION) {
      return WorkflowSchema.parse(data);
    }

    // Migrate to current version
    const migrated = { ...data };

    // Always update version to current when migrating
    migrated.version = CURRENT_WORKFLOW_SCHEMA_VERSION;

    // Validate with Zod and return typed result
    return WorkflowSchema.parse(migrated);
  }

  /**
   * Save current workflow data to YAML file
   */
  save(): void {
    try {
      // Data is already validated in constructor, no need to revalidate
      const yamlContent = stringifyYaml(this.data, {
        indent: 2,
        lineWidth: 80,
        minContentWidth: 20,
      });
      writeFileSync(this.filePath, yamlContent, 'utf8');
    } catch (error) {
      if (error instanceof Error) {
        throw new WorkflowLoadError(
          `Failed to save workflow config: ${error.message}`,
          error
        );
      }
      throw new WorkflowLoadError(`Failed to save workflow config: ${error}`);
    }
  }

  /**
   * Get the effective tool for a step (step-specific or default)
   * Only works with AgentStep - other step types don't have tool property
   */
  getStepTool(stepId: string, defaultTool?: string): string | undefined {
    const step = this.data.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    // Check if this is an agent step (only agent steps have tool/model)
    if (!isAgentStep(step)) {
      throw new Error(
        `Step "${stepId}" is not an agent step (type: ${step.type}). Only agent steps support tool configuration.`
      );
    }

    return step.tool || defaultTool || this.data.defaults?.tool;
  }

  /**
   * Get the effective model for a step (step-specific or default)
   * Only works with AgentStep - other step types don't have model property
   */
  getStepModel(stepId: string, defaultModel?: string): string | undefined {
    const step = this.data.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    // Check if this is an agent step (only agent steps have tool/model)
    if (!isAgentStep(step)) {
      throw new Error(
        `Step "${stepId}" is not an agent step (type: ${step.type}). Only agent steps support model configuration.`
      );
    }

    return step.model || defaultModel || this.data.defaults?.model;
  }

  /**
   * Get step by ID
   * Returns the generic WorkflowStep union type
   */
  getStep(stepId: string): WorkflowStep {
    const step = this.data.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }
    return step;
  }

  /**
   * Get agent step by ID
   * Throws if the step is not an agent step
   */
  getAgentStep(stepId: string): AgentStep {
    const step = this.getStep(stepId);
    if (!isAgentStep(step)) {
      throw new Error(`Step "${stepId}" is not an agent step`);
    }
    return step;
  }

  /**
   * Get step timeout (step-specific or global default)
   * Only works with AgentStep - other step types may not have config
   */
  getStepTimeout(stepId: string): number {
    const step = this.getStep(stepId);

    // Only agent steps support config for now
    if (!isAgentStep(step)) {
      // For future step types, return global or default timeout
      return this.data.config?.timeout || DEFAULT_STEP_TIMEOUT;
    }

    return (
      step.config?.timeout || this.data.config?.timeout || DEFAULT_STEP_TIMEOUT
    );
  }

  /**
   * Get step retry count
   * Only works with AgentStep - other step types may not have retries
   */
  getStepRetries(stepId: string): number {
    const step = this.getStep(stepId);

    // Only agent steps support retries for now
    if (!isAgentStep(step)) {
      return 0; // Future step types default to no retries
    }

    return step.config?.retries || 0;
  }

  // Data Access (Getters)
  get version(): string {
    return this.data.version;
  }

  get name(): string {
    return this.data.name;
  }

  get description(): string {
    return this.data.description;
  }

  get inputs(): WorkflowInput[] {
    return this.data.inputs || [];
  }

  get outputs(): WorkflowOutput[] {
    return this.data.outputs || [];
  }

  get steps(): WorkflowStep[] {
    return this.data.steps;
  }

  get defaults(): WorkflowDefaults | undefined {
    return this.data.defaults;
  }

  get config(): WorkflowConfig | undefined {
    return this.data.config;
  }

  /**
   * Export to YAML string
   */
  toYaml(): string {
    return stringifyYaml(this.data, {
      indent: 2,
      lineWidth: 80,
      minContentWidth: 20,
    });
  }

  /**
   * Validate provided inputs against workflow requirements
   * @param providedInputs - Map of input name to value
   * @returns Object with validation result and any errors/warnings
   */
  validateInputs(providedInputs: Map<string, string>): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for required inputs
    for (const input of this.inputs) {
      const providedValue = providedInputs.get(input.name);

      if (input.required && !providedValue && !input.default) {
        errors.push(`Required input "${input.name}" is missing`);
      }
    }

    // Check for unknown inputs (inputs not defined in the workflow)
    const definedInputNames = new Set(this.inputs.map(i => i.name));
    for (const [providedName] of providedInputs) {
      if (!definedInputNames.has(providedName)) {
        warnings.push(
          `Unknown input "${providedName}" provided (not defined in workflow)`
        );
      }
    }

    // Check for duplicate inputs in workflow definition (validation issue)
    const inputNameCounts = new Map<string, number>();
    for (const input of this.inputs) {
      const count = inputNameCounts.get(input.name) || 0;
      inputNameCounts.set(input.name, count + 1);
    }
    for (const [name, count] of inputNameCounts) {
      if (count > 1) {
        errors.push(
          `Input "${name}" is defined ${count} times in workflow (should be unique)`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
