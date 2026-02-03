import { SandboxPackage } from '../types.js';

export class PipSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'pip';

  installScript(): string {
    // Install pip
    return `sudo apt-get update && sudo apt-get install -y --no-install-recommends python3-pip`;
  }

  initScript(): string {
    return ``;
  }
}
