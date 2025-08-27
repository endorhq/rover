export let VERBOSE = false;

export function setVerbose(verbose: boolean) {
    VERBOSE = verbose;
}

export { launch, launchSync, setVerbose } from './os.js';
