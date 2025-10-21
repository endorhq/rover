/**
 * Zod schemas for runtime validation of workflow YAML files
 */

import { z } from 'zod';

// Input schemas
export const WorkflowInputTypeSchema = z.enum(['string', 'number', 'boolean']);

export const WorkflowInputSchema = z.object({
  name: z.string(),
  description: z.string(),
  label: z.string().optional(),
  type: WorkflowInputTypeSchema,
  required: z.boolean(),
});

// Output schemas
export const WorkflowOutputTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'file',
]);

export const WorkflowOutputSchema = z.object({
  name: z.string(),
  description: z.string(),
  type: WorkflowOutputTypeSchema,
  filename: z.string().optional(),
});

// Defaults schema
export const WorkflowDefaultsSchema = z
  .object({
    tool: z.string().optional(),
    model: z.string().optional(),
  })
  .optional();

// Config schema
export const WorkflowConfigSchema = z
  .object({
    timeout: z.number().optional(),
    continueOnError: z.boolean().optional(),
  })
  .optional();

// Base step schema
const BaseWorkflowStepSchema = z.object({
  id: z.string(),
  name: z.string(),
});

// Agent step schema
export const AgentStepSchema = BaseWorkflowStepSchema.extend({
  type: z.literal('agent'),
  prompt: z.string(),
  outputs: z.array(WorkflowOutputSchema).optional(),
});

// Command step schema
export const CommandStepSchema = BaseWorkflowStepSchema.extend({
  type: z.literal('command'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  outputs: z.array(WorkflowOutputSchema).optional(),
});

// Forward declare WorkflowStepSchema for recursive types
export const WorkflowStepSchema: z.ZodType<any> = z.lazy(() =>
  z.union([
    AgentStepSchema,
    // TODO: Support all different types
    // ConditionalStepSchema,
    // ParallelStepSchema,
    // SequentialStepSchema,
    // CommandStepSchema,
  ])
);

// Conditional step schema (recursive)
export const ConditionalStepSchema: z.ZodType<any> =
  BaseWorkflowStepSchema.extend({
    type: z.literal('conditional'),
    condition: z.string(),
    then: z.lazy(() => z.array(WorkflowStepSchema)).optional(),
    else: z.lazy(() => z.array(WorkflowStepSchema)).optional(),
  });

// Parallel step schema (recursive)
export const ParallelStepSchema: z.ZodType<any> = BaseWorkflowStepSchema.extend(
  {
    type: z.literal('parallel'),
    steps: z.lazy(() => z.array(WorkflowStepSchema)),
  }
);

// Sequential step schema (recursive)
export const SequentialStepSchema: z.ZodType<any> =
  BaseWorkflowStepSchema.extend({
    type: z.literal('sequential'),
    steps: z.lazy(() => z.array(WorkflowStepSchema)),
  });

// Main workflow schema
export const WorkflowSchema = z.object({
  version: z.string(),
  name: z.string(),
  description: z.string(),
  inputs: z.array(WorkflowInputSchema).optional(),
  outputs: z.array(WorkflowOutputSchema).optional(),
  defaults: WorkflowDefaultsSchema.optional(),
  config: WorkflowConfigSchema.optional(),
  steps: z.array(WorkflowStepSchema),
});

// Export type inferred from schema for convenience
export type WorkflowSchemaType = z.infer<typeof WorkflowSchema>;
