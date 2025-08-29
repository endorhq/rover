export let VERBOSE = false;

export const setVerbose = (verbose: boolean) => {
    VERBOSE = verbose;
}

export { launch, launchSync } from './os.js';
