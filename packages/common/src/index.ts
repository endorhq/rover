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
} from './display/index.js';
