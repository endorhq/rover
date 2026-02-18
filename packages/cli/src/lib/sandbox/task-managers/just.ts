import { SandboxPackage } from '../types.js';

export class JustSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'just';

  installScript(): string {
    return `sudo apt-get install -y --no-install-recommends just`;
  }

  initScript(): string {
    return ``;
  }
}
