export const PROJECT_CONFIG_FILE = 'rover.json';

// Re-export from verbose.ts
export { VERBOSE, setVerbose } from './verbose.js';

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

export { Git } from './git.js';

export {
  requiredClaudeCredentials,
  requiredBedrockCredentials,
  requiredVertexAiCredentials,
} from './credential-utils.js';

export {
  showSplashHeader,
  showRegularHeader,
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
  type DiagramStep,
  type DiagramOptions,
} from './display/index.js';

// Reexport the enum from schemas
export { AI_AGENT } from 'rover-schemas';

export {
  getConfigDir,
  getDataDir,
  getCacheDir,
  ensureDirectories,
} from './paths.js';

export {
  detectEnvironment,
  ProjectManagerLoadError,
  ProjectManagerRegistrationError,
  ProjectManager,
  type EnvironmentResult,
} from './project/index.js';

export {
  GlobalConfigManager,
  IterationStatusManager,
  IterationManager,
  PreContextDataManager,
  ProjectConfigManager,
  TaskDescriptionStore,
  TaskDescriptionManager,
  UserSettingsManager,
  WorkflowStore,
  WorkflowSource,
  WorkflowManager,
  type WorkflowEntry,
} from './files/index.js';
