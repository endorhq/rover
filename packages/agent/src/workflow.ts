/**
 * Workflow configuration loader and processor for agent workflows.
 * Handles loading, validating, and managing YAML-based agent workflow definitions.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  AgentWorkflowSchema,
  WorkflowInput,
  WorkflowOutput,
  AgentStep,
} from './schema.js';

const CURRENT_WORKFLOW_SCHEMA_VERSION = '1.0';

// Default step timeout in seconds
const DEFAULT_STEP_TIMEOUT = 60 * 30; // 30 minutes

/**
 * Workflow configuration class for loading and managing agent workflow definitions.
 * Provides validation, loading, and execution preparation for YAML-based workflows.
 */
export class AgentWorkflow {
  private data: AgentWorkflowSchema;
  filePath: string;

  constructor(data: AgentWorkflowSchema, filePath: string) {
    this.data = data;
    this.filePath = filePath;
    this.validate();
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
    steps: AgentStep[] = []
  ): AgentWorkflow {
    const schema: AgentWorkflowSchema = {
      version: CURRENT_WORKFLOW_SCHEMA_VERSION,
      name,
      description,
      inputs,
      outputs,
      defaults: {
        tool: 'claude',
        model: 'claude-3-sonnet',
      },
      config: {
        timeout: 3600, // 1 hour default
        continueOnError: false,
      },
      steps,
    };

    const instance = new AgentWorkflow(schema, filePath);
    instance.save();
    return instance;
  }

  /**
   * Load an existing workflow configuration from YAML file
   */
  static load(filePath: string): AgentWorkflow {
    if (!existsSync(filePath)) {
      throw new Error(`Workflow configuration not found at ${filePath}`);
    }

    try {
      const rawData = readFileSync(filePath, 'utf8');
      const parsedData = parseYaml(rawData) as AgentWorkflowSchema;

      // Migrate if necessary
      const migratedData = AgentWorkflow.migrate(parsedData);

      const instance = new AgentWorkflow(migratedData, filePath);

      // If migration occurred, save the updated data
      if (migratedData.version !== parsedData.version) {
        instance.save();
      }

      return instance;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load workflow config: ${error.message}`);
      }
      throw new Error(`Failed to load workflow config: ${error}`);
    }
  }

  /**
   * Migrate old workflow schema to current version
   */
  private static migrate(data: any): AgentWorkflowSchema {
    // If already current version, return as-is
    if (data.version === CURRENT_WORKFLOW_SCHEMA_VERSION) {
      return data as AgentWorkflowSchema;
    }

    // Add migration logic here as schemas evolve
    // For now, just ensure required fields exist
    const migrated = { ...data };

    if (!migrated.version) {
      migrated.version = CURRENT_WORKFLOW_SCHEMA_VERSION;
    }

    if (!migrated.defaults) {
      migrated.defaults = {
        tool: 'claude',
        model: 'claude-3-sonnet',
      };
    }

    if (!migrated.config) {
      migrated.config = {
        timeout: 3600,
        continueOnError: false,
      };
    }

    return migrated as AgentWorkflowSchema;
  }

  /**
   * Save current workflow data to YAML file
   */
  save(): void {
    try {
      this.validate();
      const yamlContent = stringifyYaml(this.data, {
        indent: 2,
        lineWidth: 80,
        minContentWidth: 20,
      });
      writeFileSync(this.filePath, yamlContent, 'utf8');
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to save workflow config: ${error.message}`);
      }
      throw new Error(`Failed to save workflow config: ${error}`);
    }
  }

  /**
   * Validate the workflow configuration
   */
  private validate(): void {
    const errors: string[] = [];

    // Required fields
    if (typeof this.data.version !== 'string') {
      errors.push('version is required');
    }
    if (typeof this.data.name !== 'string' || !this.data.name) {
      errors.push('name is required');
    }
    if (typeof this.data.description !== 'string' || !this.data.description) {
      errors.push('description is required');
    }
    if (!Array.isArray(this.data.inputs)) {
      errors.push('inputs must be an array');
    }
    if (!Array.isArray(this.data.outputs)) {
      errors.push('outputs must be an array');
    }
    if (!Array.isArray(this.data.steps)) {
      errors.push('steps must be an array');
    }

    // Validate inputs
    if (Array.isArray(this.data.inputs)) {
      this.data.inputs.forEach((input, index) => {
        if (!input.name) {
          errors.push(`input[${index}].name is required`);
        }
        if (!input.type) {
          errors.push(`input[${index}].type is required`);
        }
        if (typeof input.required !== 'boolean') {
          errors.push(`input[${index}].required must be boolean`);
        }
      });
    }

    // Validate outputs
    if (Array.isArray(this.data.outputs)) {
      this.data.outputs.forEach((output, index) => {
        if (!output.name) {
          errors.push(`output[${index}].name is required`);
        }
        if (!output.type) {
          errors.push(`output[${index}].type is required`);
        }
        // Validate that file outputs have a filename
        if (output.type === 'file' && !output.filename) {
          errors.push(
            `output[${index}].filename is required for file type outputs`
          );
        }
      });
    }

    // Validate steps
    if (Array.isArray(this.data.steps)) {
      this.data.steps.forEach((step, index) => {
        if (!step.id) {
          errors.push(`step[${index}].id is required`);
        }
        if (!step.name) {
          errors.push(`step[${index}].name is required`);
        }
        if (!step.prompt) {
          errors.push(`step[${index}].prompt is required`);
        }
        if (!Array.isArray(step.outputs)) {
          errors.push(`step[${index}].outputs must be an array`);
        } else {
          // Validate each step output
          step.outputs.forEach((output, outputIndex) => {
            if (!output.name) {
              errors.push(
                `step[${index}].outputs[${outputIndex}].name is required`
              );
            }
            if (!output.type) {
              errors.push(
                `step[${index}].outputs[${outputIndex}].type is required`
              );
            }
            // Validate that file outputs have a filename
            if (output.type === 'file' && !output.filename) {
              errors.push(
                `step[${index}].outputs[${outputIndex}].filename is required for file type outputs`
              );
            }
          });
        }
      });

      // Check for duplicate step IDs
      const stepIds = this.data.steps.map(step => step.id);
      const duplicateIds = stepIds.filter(
        (id, index) => stepIds.indexOf(id) !== index
      );
      if (duplicateIds.length > 0) {
        errors.push(`duplicate step IDs found: ${duplicateIds.join(', ')}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Workflow validation error: ${errors.join(', ')}`);
    }
  }

  /**
   * Get the effective tool for a step (step-specific or default)
   */
  getStepTool(stepId: string, defaultTool?: string): string | undefined {
    const step = this.data.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }
    return step.tool || defaultTool || this.data.defaults?.tool;
  }

  /**
   * Get the effective model for a step (step-specific or default)
   */
  getStepModel(stepId: string, defaultModel?: string): string | undefined {
    const step = this.data.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }
    return step.model || defaultModel || this.data.defaults?.model;
  }

  /**
   * Get step by ID
   */
  getStep(stepId: string): AgentStep {
    const step = this.data.steps.find(s => s.id === stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }
    return step;
  }

  /**
   * Get step timeout (step-specific or global default)
   */
  getStepTimeout(stepId: string): number {
    const step = this.getStep(stepId);
    return (
      step.config?.timeout || this.data.config?.timeout || DEFAULT_STEP_TIMEOUT
    );
  }

  /**
   * Get step retry count
   */
  getStepRetries(stepId: string): number {
    const step = this.getStep(stepId);
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
    return this.data.inputs;
  }

  get outputs(): WorkflowOutput[] {
    return this.data.outputs;
  }

  get steps(): AgentStep[] {
    return this.data.steps;
  }

  get defaults(): { tool?: string; model?: string } | undefined {
    return this.data.defaults;
  }

  get config(): { timeout?: number; continueOnError?: boolean } | undefined {
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
