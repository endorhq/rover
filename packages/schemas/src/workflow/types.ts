/**
 * TypeScript types for workflow YAML structure
 * All types are inferred from Zod schemas to ensure consistency
 */

import z from 'zod';
import {
  WorkflowInputTypeSchema,
  WorkflowInputSchema,
  WorkflowOutputTypeSchema,
  WorkflowOutputSchema,
  WorkflowDefaultsSchema,
  WorkflowConfigSchema,
  WorkflowAgentToolSchema,
  WorkflowAgentStepSchema,
  WorkflowCommandStepSchema,
  WorkflowConditionalStepSchema,
  WorkflowParallelStepSchema,
  WorkflowSequentialStepSchema,
  WorkflowStepSchema,
  WorkflowSchema,
} from './schema.js';

// Input types
export type WorkflowInputType = z.infer<typeof WorkflowInputTypeSchema>;
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

// Output types
export type WorkflowOutputType = z.infer<typeof WorkflowOutputTypeSchema>;
export type WorkflowOutput = z.infer<typeof WorkflowOutputSchema>;

// Agent tool type
export type WorkflowAgentTool = z.infer<typeof WorkflowAgentToolSchema>;

// Defaults
export type WorkflowDefaults = z.infer<typeof WorkflowDefaultsSchema>;

// Config
export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;

// Step types - all inferred from Zod schemas
export type WorkflowAgentStep = z.infer<typeof WorkflowAgentStepSchema>;
export type WorkflowCommandStep = z.infer<typeof WorkflowCommandStepSchema>;
export type WorkflowConditionalStep = z.infer<
  typeof WorkflowConditionalStepSchema
>;
export type WorkflowParallelStep = z.infer<typeof WorkflowParallelStepSchema>;
export type WorkflowSequentialStep = z.infer<
  typeof WorkflowSequentialStepSchema
>;

// Discriminated union of all step types
export type WorkflowStep = z.infer<typeof WorkflowAgentStepSchema>;

// Main workflow structure
export type Workflow = z.infer<typeof WorkflowSchema>;

// Type guards for step types
export function isAgentStep(step: WorkflowStep): step is WorkflowAgentStep {
  return step.type === 'agent';
}
