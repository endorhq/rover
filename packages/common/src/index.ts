export let VERBOSE = false;
export const PROJECT_CONFIG_FILE = 'rover.json';

export const setVerbose = (verbose: boolean) => {
  VERBOSE = verbose;
};

export {
  findProjectRoot,
  clearProjectRootCache,
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

export { AI_AGENT } from './agent.js';
