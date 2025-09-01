export let VERBOSE = false;

export const setVerbose = (verbose: boolean) => {
  VERBOSE = verbose;
};

export {
  launch,
  launchSync,
  type Options,
  type Result,
  type SyncOptions,
  type SyncResult,
} from './os.js';
