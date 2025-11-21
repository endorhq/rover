import { SandboxPackage } from '../types.js';

export class GomodSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'gomod';

  installScript(): string {
    // go mod is built into Go 1.11+, no additional installation needed
    return ``;
  }

  initScript(): string {
    // go mod uses GOPATH which is configured by go language package
    return ``;
  }
}
