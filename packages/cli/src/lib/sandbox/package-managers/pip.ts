import { SandboxPackage } from '../types.js';

export class PipSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'pip';

  installScript(): string {
    // Install pip
    return `sudo apk add --no-cache py3-pip`;
  }

  initScript(): string {
    return ``;
  }
}
