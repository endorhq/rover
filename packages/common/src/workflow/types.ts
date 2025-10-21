/**
 * TypeScript types for workflow YAML structure
 * Each step type is defined independently to support future extensibility
 */

// Input types
export type WorkflowInputType = 'string' | 'number' | 'boolean' | 'file';

export interface WorkflowInput {
  name: string;
  description: string;
  type: WorkflowInputType;
  required: boolean;
}

// Output types
export type WorkflowOutputType = 'string' | 'number' | 'boolean' | 'file';

export interface WorkflowOutput {
  name: string;
  description: string;
  type: WorkflowOutputType;
  filename?: string;
}

// Defaults
export interface WorkflowDefaults {
  tool?: string;
  model?: string;
}

// Config
export interface WorkflowConfig {
  timeout?: number;
  continueOnError?: boolean;
}

// Base step type
export interface BaseWorkflowStep {
  id: string;
  name: string;
}

// Agent step type
export interface AgentStep extends BaseWorkflowStep {
  type: 'agent';
  prompt: string;
  outputs?: WorkflowOutput[];
}

// Conditional step type
export interface ConditionalStep extends BaseWorkflowStep {
  type: 'conditional';
  condition: string;
  then?: WorkflowStep[];
  else?: WorkflowStep[];
}

// Parallel step type
export interface ParallelStep extends BaseWorkflowStep {
  type: 'parallel';
  steps: WorkflowStep[];
}

// Sequential step type
export interface SequentialStep extends BaseWorkflowStep {
  type: 'sequential';
  steps: WorkflowStep[];
}

// Command step type
export interface CommandStep extends BaseWorkflowStep {
  type: 'command';
  command: string;
  args?: string[];
  outputs?: WorkflowOutput[];
}

// Discriminated union of all step types
export type WorkflowStep =
  | AgentStep
  | ConditionalStep
  | ParallelStep
  | SequentialStep
  | CommandStep;

// Main workflow structure
export interface Workflow {
  version: string;
  name: string;
  description: string;
  inputs?: WorkflowInput[];
  outputs?: WorkflowOutput[];
  defaults?: WorkflowDefaults;
  config?: WorkflowConfig;
  steps: WorkflowStep[];
}

// Type guards for step types
export function isAgentStep(step: WorkflowStep): step is AgentStep {
  return step.type === 'agent';
}

export function isConditionalStep(step: WorkflowStep): step is ConditionalStep {
  return step.type === 'conditional';
}

export function isParallelStep(step: WorkflowStep): step is ParallelStep {
  return step.type === 'parallel';
}

export function isSequentialStep(step: WorkflowStep): step is SequentialStep {
  return step.type === 'sequential';
}

export function isCommandStep(step: WorkflowStep): step is CommandStep {
  return step.type === 'command';
}
