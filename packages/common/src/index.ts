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
