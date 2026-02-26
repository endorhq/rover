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
  'opencode',
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
  /** Maximum iterations any loop step may run (ceiling for per-loop maxIterations) */
  loopLimit: z.number().int().positive().optional(),
});

/**
 * Regex for validating condition expressions used in `if` and `until` fields.
 * Format: steps.<id>.outputs.<name> == <value>
 *         steps.<id>.outputs.<name> != <value>
 */
const CONDITION_REGEX = /^steps\.[\w-]+\.outputs\.[\w-]+\s*(==|!=)\s*.+$/;

const WorkflowBaseStepSchema = z.object({
  /** Unique step identifier */
  id: z.string(),
  /** Human-readable step name */
  name: z.string(),
  /** Optional condition; step is skipped when it evaluates to false */
  if: z
    .string()
    .regex(
      CONDITION_REGEX,
      'Condition must match format: steps.<id>.outputs.<name> == <value>'
    )
    .optional(),
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
  /** Whether to allow the command to fail without stopping the workflow */
  allow_failure: z.boolean().optional(),
  /** Expected outputs from this step */
  outputs: z.array(WorkflowOutputSchema).optional(),
});

/**
 * Loop step schema (recursive)
 * Repeats sub-steps until a condition is met or max iterations reached
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for recursive Zod schema type inference
export const WorkflowLoopStepSchema: z.ZodType<any> =
  WorkflowBaseStepSchema.extend({
    /** Step type - 'loop' */
    type: z.literal('loop'),
    /** Sub-steps to repeat each iteration */
    steps: z.lazy(() => z.array(WorkflowStepSchema)),
    /** Condition to check after each sub-step; loop exits when true */
    until: z
      .string()
      .regex(
        CONDITION_REGEX,
        'Condition must match format: steps.<id>.outputs.<name> == <value>'
      ),
    /** Maximum iterations before giving up (default: 3) */
    maxIterations: z.number().int().positive().optional(),
  });

/**
 * Union of all step types (discriminated by 'type' field)
 * Forward declared for recursive types
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for recursive Zod schema type inference
export const WorkflowStepSchema: z.ZodType<any> = z.union([
  WorkflowAgentStepSchema,
  WorkflowCommandStepSchema,
  WorkflowLoopStepSchema,
]);

/**
 * Recursively collect all step IDs, including those nested inside loop steps.
 */
interface StepIdNode {
  id: string;
  type: string;
  steps?: StepIdNode[];
}

function collectStepIds(steps: StepIdNode[]): string[] {
  const ids: string[] = [];
  for (const step of steps) {
    ids.push(step.id);
    if (step.type === 'loop' && Array.isArray(step.steps)) {
      ids.push(...collectStepIds(step.steps));
    }
  }
  return ids;
}

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
      const stepIds = collectStepIds(data.steps);
      return new Set(stepIds).size === stepIds.length;
    },
    {
      message: 'Duplicate step IDs found in workflow',
      path: ['steps'],
    }
  );
