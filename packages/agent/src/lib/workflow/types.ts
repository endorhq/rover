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
  AgentToolSchema,
  AgentStepSchema,
  CommandStepSchema,
  ConditionalStepSchema,
  ParallelStepSchema,
  SequentialStepSchema,
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
export type AgentTool = z.infer<typeof AgentToolSchema>;

// Defaults
export type WorkflowDefaults = z.infer<typeof WorkflowDefaultsSchema>;

// Config
export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;

// Step types - all inferred from Zod schemas
export type AgentStep = z.infer<typeof AgentStepSchema>;
export type CommandStep = z.infer<typeof CommandStepSchema>;
export type ConditionalStep = z.infer<typeof ConditionalStepSchema>;
export type ParallelStep = z.infer<typeof ParallelStepSchema>;
export type SequentialStep = z.infer<typeof SequentialStepSchema>;

// Discriminated union of all step types
export type WorkflowStep = z.infer<typeof AgentStepSchema>;

// Main workflow structure
export type Workflow = z.infer<typeof WorkflowSchema>;

// Type guards for step types
export function isAgentStep(step: WorkflowStep): step is AgentStep {
  return step.type === 'agent';
}
