import { SandboxPackage } from '../types.js';

export class PHPSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'php';

  installScript(): string {
    // Install php. If build base is required, the agent will take care of installing it
    return `sudo apt-get update && sudo apt-get install -y --no-install-recommends php php-dev`;
  }

  initScript(): string {
    // Nothing for now
    return ``;
  }
}
