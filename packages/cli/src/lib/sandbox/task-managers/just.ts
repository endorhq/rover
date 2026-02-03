import { SandboxPackage } from '../types.js';

export class JustSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'just';

  installScript(): string {
    // Install just command runner
    return `curl --proto '=https' --tlsv1.2 -sSf https://just.systems/install.sh | bash -s -- --to /usr/local/bin`;
  }

  initScript(): string {
    return ``;
  }
}
