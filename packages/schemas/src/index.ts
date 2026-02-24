// Declare all schemas, types, and errors
export { AI_AGENT } from './agent.js';

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
  type WorkflowAgentStep,
  type WorkflowAgentTool,
  type WorkflowConditionalStep,
  type WorkflowParallelStep,
  type WorkflowSequentialStep,
  type WorkflowCommandStep,
  isAgentStep,
  isCommandStep,
} from './workflow/types.js';

export {
  WorkflowLoadError,
  WorkflowValidationError,
} from './workflow/errors.js';

export {
  CURRENT_WORKFLOW_SCHEMA_VERSION,
  WorkflowSchema,
} from './workflow/schema.js';

// Previous Iteration library
export type { PreviousIteration } from './previous-iteration/types.js';

export { PreviousIterationValidationError } from './previous-iteration/errors.js';

// Pre-Context Data library
export type {
  PreContextData,
  InitialTask,
} from './pre-context-data/types.js';

export {
  PreContextDataLoadError,
  PreContextDataValidationError,
} from './pre-context-data/errors.js';

export {
  PRE_CONTEXT_DATA_FILENAME,
  CURRENT_PRE_CONTEXT_DATA_SCHEMA_VERSION,
  PreContextDataSchema,
} from './pre-context-data/schema.js';

// Iteration Status library
export type {
  IterationStatus,
  IterationStatusName,
} from './iteration-status/types.js';

export {
  IterationStatusLoadError,
  IterationStatusValidationError,
} from './iteration-status/errors.js';

export {
  ITERATION_STATUS_FILENAME,
  IterationStatusSchema,
} from './iteration-status/schema.js';

// Iteration library
export type {
  Iteration,
  IterationPreviousContext,
  TrustSettings,
  Provenance,
  ContextMetadata,
  IterationContextEntry,
} from './iteration/types.js';

export {
  IterationLoadError,
  IterationValidationError,
} from './iteration/errors.js';

export {
  ITERATION_FILENAME,
  CURRENT_ITERATION_SCHEMA_VERSION,
  IterationSchema,
  IterationPreviousContextSchema,
  TrustSettingsSchema,
  ProvenanceSchema,
  ContextMetadataSchema,
  IterationContextEntrySchema,
} from './iteration/schema.js';

// Task Description library
export type {
  TaskStatus,
  TaskDescription,
  CreateTaskData,
  StatusMetadata,
  IterationMetadata,
  TaskSource,
  SourceType,
} from './task-description/types.js';

export {
  TaskNotFoundError,
  TaskValidationError,
  TaskSchemaError,
  TaskFileError,
} from './task-description/errors.js';

export {
  CURRENT_TASK_DESCRIPTION_SCHEMA_VERSION,
  TaskDescriptionSchema,
  SourceTypeSchema,
  TaskSourceSchema,
} from './task-description/schema.js';

// Project Config library
export type {
  Language,
  MCP,
  PackageManager,
  TaskManager,
  NetworkMode,
  NetworkRule,
  NetworkConfig,
  SandboxConfig,
  HooksConfig,
  ProjectConfig,
} from './project-config/types.js';

export {
  ProjectConfigLoadError,
  ProjectConfigValidationError,
  ProjectConfigSaveError,
} from './project-config/errors.js';

export {
  CURRENT_PROJECT_SCHEMA_VERSION,
  PROJECT_CONFIG_FILENAME,
  ProjectConfigSchema,
  NETWORK_MODE_VALUES,
} from './project-config/schema.js';

// User Settings library
export type {
  AiAgent,
  UserDefaults,
  UserSettings,
} from './user-settings/types.js';

export {
  UserSettingsLoadError,
  UserSettingsSaveError,
  UserSettingsValidationError,
} from './user-settings/errors.js';

export {
  CURRENT_USER_SCHEMA_VERSION,
  USER_SETTINGS_FILENAME,
  USER_SETTINGS_DIR,
  UserSettingsSchema,
} from './user-settings/schema.js';

// Global Config library
export type {
  AttributionStatus,
  TelemetryStatus,
  GlobalProject,
  GlobalConfig,
} from './global-config/types.js';

export {
  GlobalConfigLoadError,
  GlobalConfigValidationError,
  GlobalConfigSaveError,
} from './global-config/errors.js';

export {
  CURRENT_GLOBAL_CONFIG_VERSION,
  GLOBAL_CONFIG_FILENAME,
  GlobalConfigSchema,
} from './global-config/schema.js';

// JSONL Log library
export type {
  JsonlLogEntry,
  LogLevel,
  LogEvent,
} from './jsonl-log/types.js';

export {
  JsonlLogWriteError,
  JsonlLogReadError,
  JsonlLogValidationError,
} from './jsonl-log/errors.js';

export {
  ROVER_LOG_FILENAME,
  AGENT_LOGS_DIR,
  LogLevelSchema,
  LogEventSchema,
  JsonlLogEntrySchema,
} from './jsonl-log/schema.js';

// Rexport some Zod utilities so consumers do not need to depend on Zod
export { ZodError } from 'zod';
