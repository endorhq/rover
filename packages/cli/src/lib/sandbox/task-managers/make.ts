import { SandboxPackage } from '../types.js';

export class MakeSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'make';

  installScript(): string {
    // Install GNU Make
    return `sudo apk add --no-cache make`;
  }

  initScript(): string {
    // make is installed system-wide, no user configuration needed
    return ``;
  }
}
