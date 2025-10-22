/**
 * Expose the internal libraries and workflow definitions.
 * It allows other clients (like the CLI) to work with workflows
 * properly.
 *
 * The agent package is the source of truth for workflow definition.
 */

// Workflow library
export {
  type Workflow,
  type WorkflowInput,
  type WorkflowInputType,
  type WorkflowOutput,
  type WorkflowOutputType,
  type WorkflowDefaults,
  type WorkflowConfig,
  type WorkflowStep,
  type AgentStep,
  type ConditionalStep,
  type ParallelStep,
  type SequentialStep,
  type CommandStep,
  isAgentStep,
} from './lib/workflow/types.js';

export {
  WorkflowSchema,
  WorkflowInputSchema,
  WorkflowOutputSchema,
  WorkflowDefaultsSchema,
  WorkflowConfigSchema,
  WorkflowStepSchema,
  AgentStepSchema,
  ConditionalStepSchema,
  ParallelStepSchema,
  SequentialStepSchema,
  CommandStepSchema,
} from './lib/workflow/schema.js';

export {
  loadWorkflow,
  loadWorkflowFromString,
  WorkflowLoadError,
  WorkflowValidationError,
} from './lib/workflow/loader.js';

export { AgentWorkflow } from './lib/workflow.js';
