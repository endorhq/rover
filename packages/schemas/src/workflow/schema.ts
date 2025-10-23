/**
 * Zod schemas for runtime validation of workflow YAML files
 */

import { z } from 'zod';

// Current schema version
export const CURRENT_WORKFLOW_SCHEMA_VERSION = '1.0';

/**
 * Supported input/output data types for agent workflows.
 * We will add more supported types in the future
 */
export const WorkflowInputTypeSchema = z.enum(['string', 'number', 'boolean']);

/**
 * Input parameter definition for the workflow
 */
export const WorkflowInputSchema = z.object({
  /** Parameter name */
  name: z.string(),
  /** Human-readable description */
  description: z.string(),
  /** Label to display in the UI or CLI */
  label: z.string().optional(),
  /** Data type */
  type: WorkflowInputTypeSchema,
  /** Whether this parameter is required */
  required: z.boolean(),
  /** Default value if not required */
  default: z.any().optional(),
});

/**
 * Supported output data types (includes 'file' type)
 */
export const WorkflowOutputTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'file',
]);

/**
 * Output definition for the workflow or individual steps
 */
export const WorkflowOutputSchema = z.object({
  /** Output name */
  name: z.string(),
  /** Human-readable description */
  description: z.string(),
  /** Data type */
  type: WorkflowOutputTypeSchema,
  /** Filename where the output should be saved (required for 'file' type) */
  filename: z.string().optional(),
  /** Required fields for object outputs */
  required: z.boolean().optional(),
});

/**
 * Supported AI agent tools/providers
 */
export const WorkflowAgentToolSchema = z.enum([
  'claude',
  'gemini',
  'codex',
  'qwen',
]);

/**
 * Default configuration when it's not specified. Users will set it using the agent tool
 */
export const WorkflowDefaultsSchema = z.object({
  /** Default AI tool if not specified in steps */
  tool: WorkflowAgentToolSchema.optional(),
  /** Default model if not specified in steps */
  model: z.string().optional(),
});

/**
 * Optional workflow-level configuration
 */
export const WorkflowConfigSchema = z.object({
  /** Global timeout for entire workflow */
  timeout: z.number().optional(),
  /** Whether to continue on step failures */
  continueOnError: z.boolean().optional(),
});

/**
 * Base step schema shared by all step types
 */
const WorkflowBaseStepSchema = z.object({
  /** Unique step identifier */
  id: z.string(),
  /** Human-readable step name */
  name: z.string(),
});

/**
 * Agent step configuration
 */
export const WorkflowAgentStepSchema = WorkflowBaseStepSchema.extend({
  /** Step type - 'agent' */
  type: z.literal('agent'),
  /** AI tool/provider to use (optional, uses workflow default) */
  tool: WorkflowAgentToolSchema.optional(),
  /** Specific model version (optional, uses tool default) */
  model: z.string().optional(),
  /** Prompt template with placeholder support */
  prompt: z.string(),
  /** Expected outputs from this step */
  outputs: z.array(WorkflowOutputSchema).optional(),
  /** Optional step configuration */
  config: z
    .object({
      /** Maximum execution time in seconds */
      timeout: z.number().optional(),
      /** Number of retry attempts on failure */
      retries: z.number().optional(),
    })
    .optional(),
});

/**
 * Command step configuration
 */
export const WorkflowCommandStepSchema = WorkflowBaseStepSchema.extend({
  /** Step type - 'command' */
  type: z.literal('command'),
  /** Command to execute */
  command: z.string(),
  /** Command arguments */
  args: z.array(z.string()).optional(),
  /** Expected outputs from this step */
  outputs: z.array(WorkflowOutputSchema).optional(),
});

/**
 * Conditional step schema (recursive)
 * Allows branching logic based on conditions
 */
export const WorkflowConditionalStepSchema: z.ZodType<any> =
  WorkflowBaseStepSchema.extend({
    /** Step type - 'conditional' */
    type: z.literal('conditional'),
    /** Condition expression to evaluate */
    condition: z.string(),
    /** Steps to execute if condition is true */
    then: z.lazy(() => z.array(WorkflowStepSchema)).optional(),
    /** Steps to execute if condition is false */
    else: z.lazy(() => z.array(WorkflowStepSchema)).optional(),
  });

/**
 * Parallel step schema (recursive)
 * Executes multiple steps concurrently
 */
export const WorkflowParallelStepSchema: z.ZodType<any> =
  WorkflowBaseStepSchema.extend({
    /** Step type - 'parallel' */
    type: z.literal('parallel'),
    /** Steps to execute in parallel */
    steps: z.lazy(() => z.array(WorkflowStepSchema)),
  });

/**
 * Sequential step schema (recursive)
 * Executes multiple steps in order
 */
export const WorkflowSequentialStepSchema: z.ZodType<any> =
  WorkflowBaseStepSchema.extend({
    /** Step type - 'sequential' */
    type: z.literal('sequential'),
    /** Ordered list of steps to execute */
    steps: z.lazy(() => z.array(WorkflowStepSchema)),
  });

/**
 * Union of all step types (discriminated by 'type' field)
 * Forward declared for recursive types
 */
export const WorkflowStepSchema: z.ZodType<any> = z.union([
  WorkflowAgentStepSchema,
  // CommandStepSchema,
  // ConditionalStepSchema,
  // ParallelStepSchema,
  // SequentialStepSchema,
]);

/**
 * Complete agent workflow schema
 * Defines the structure of a workflow YAML file
 */
export const WorkflowSchema = z
  .object({
    /** Schema version for compatibility */
    version: z.string(),
    /** Workflow identifier */
    name: z.string(),
    /** Human-readable description */
    description: z.string(),
    /** Input parameters required by this workflow */
    inputs: z.array(WorkflowInputSchema).optional(),
    /** Expected outputs from the workflow */
    outputs: z.array(WorkflowOutputSchema).optional(),
    /** Default configuration (tool, model) */
    defaults: WorkflowDefaultsSchema.optional(),
    /** Optional workflow-level configuration (timeout, continueOnError) */
    config: WorkflowConfigSchema.optional(),
    /** Ordered list of execution steps */
    steps: z.array(WorkflowStepSchema),
  })
  .refine(
    data => {
      const stepIds = data.steps.map(s => s.id);
      return new Set(stepIds).size === stepIds.length;
    },
    {
      message: 'Duplicate step IDs found in workflow',
      path: ['steps'],
    }
  );
