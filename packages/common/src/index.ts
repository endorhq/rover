export let VERBOSE = false;
export const PROJECT_CONFIG_FILE = 'rover.json';

export const setVerbose = (verbose: boolean) => {
  VERBOSE = verbose;
};

export {
  findProjectRoot,
  launch,
  launchSync,
  type Options,
  type Result,
  type SyncOptions,
  type SyncResult,
} from './os.js';

export { getVersion } from './version.js';

export { Git } from './git.js';

export { IterationStatus, type IterationStatusSchema } from './status.js';

export {
  requiredClaudeCredentials,
  requiredBedrockCredentials,
  requiredVertexAiCredentials,
} from './credential-utils.js';

export {
  showSplashHeader,
  showRegularHeader,
  showTitle,
  showFile,
  showTips,
  showTip,
  showList,
  showProperties,
  ProcessManager,
  type DisplayColor,
  type TipsOptions,
  type ProcessItemStatus,
  type ProcessItem,
  type ProcessOptions,
  type ListOptions,
  type PropertiesOptions,
} from './display/index.js';

// Workflow exports
export {
  // Types
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
  // Type guards
  isAgentStep,
  isConditionalStep,
  isParallelStep,
  isSequentialStep,
  isCommandStep,
  // Schemas
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
  type WorkflowSchemaType,
  // Loaders
  loadWorkflow,
  loadWorkflowFromString,
  WorkflowLoadError,
  WorkflowValidationError,
} from './workflow/index.js';
