import { SandboxPackage } from '../types.js';

export class JustSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'just';

  installScript(): string {
    // Install just command runner
    return `sudo apk add just`;
  }

  initScript(): string {
    return ``;
  }
}
