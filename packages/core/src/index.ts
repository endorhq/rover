export const PROJECT_CONFIG_FILE = 'rover.json';

// Re-export from verbose.ts
export { VERBOSE, setVerbose } from './verbose.js';

export { generateRandomId } from './random-id.js';

export { findProjectRoot, clearProjectRootCache } from './project-root.js';

export {
  launch,
  launchSync,
  type Options,
  type Result,
  type SyncOptions,
  type SyncResult,
} from './os.js';

export { createGetVersion, getVersion } from './version.js';

export { Git, type GitOptions } from './git.js';

export {
  requiredClaudeCredentials,
  requiredBedrockCredentials,
  requiredVertexAiCredentials,
} from './credential-utils.js';

export {
  showTitle,
  showDiagram,
  showFile,
  showTips,
  showTip,
  showList,
  showProperties,
  ProcessManager,
  Table,
  renderTable,
  type DisplayColor,
  type TipsOptions,
  type ProcessItemStatus,
  type ProcessItem,
  type ProcessOptions,
  type ListOptions,
  type PropertiesOptions,
  type TableColumn,
  type TableOptions,
  type GroupDefinition,
  type DiagramStep,
  type DiagramOptions,
} from './display/index.js';

// Reexport the enum from schemas
export { AI_AGENT } from 'rover-schemas';

export {
  getConfigDir,
  getDataDir,
  getCacheDir,
  getProjectLogsDir,
  ensureDirectories,
} from './paths.js';

export {
  detectEnvironment,
  ProjectManager,
  ProjectStore,
  ProjectStoreLoadError,
  ProjectStoreRegistrationError,
  ProjectLoaderNotGitRepoError,
  ProjectLoaderRegistrationError,
  ProjectLoaderStoreError,
  findOrRegisterProject,
  type EnvironmentResult,
  type FindOrRegisterProjectOptions,
} from './project/index.js';

export {
  GlobalConfigManager,
  IterationStatusManager,
  IterationManager,
  PreContextDataManager,
  ProjectConfigManager,
  TaskDescriptionManager,
  UserSettingsManager,
  WorkflowStore,
  WorkflowStoreError,
  WorkflowSource,
  WorkflowManager,
  JsonlLogger,
  type StepResult,
  type AgentStepExecutor,
  type WorkflowRunner,
  type OnStepComplete,
  type WorkflowRunResult,
  type WorkflowMetadata,
  type AddWorkflowResult,
  type WorkflowEntry,
} from './files/index.js';

// Context providers
export {
  // Types
  type ContextEntry,
  type ContextProvider,
  type ContextProviderClass,
  type ProviderOptions,
  type BaseContextMetadata,
  type IssueMetadata,
  type PRMetadata,
  type PRDiffMetadata,
  type FileMetadata,
  type HTTPSResourceMetadata,
  type ContextMetadata,
  type ContextManagerOptions,
  type ContextIndexOptions,
  // Errors
  ContextError,
  ContextSchemeNotSupportedError,
  ContextUriParseError,
  ContextTypeNotSupportedError,
  ContextFetchError,
  // Registry
  registerContextProvider,
  createContextProvider,
  isContextSchemeSupported,
  getRegisteredSchemes,
  clearContextProviders,
  // Providers
  registerBuiltInProviders,
  LocalFileProvider,
  GitHubProvider,
  HTTPSProvider,
  // Manager
  ContextManager,
  // Index Generator
  generateContextIndex,
} from './context/index.js';
