import { SandboxPackage } from '../types.js';

export class NpmSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'npm';

  installScript(): string {
    // npm is already included in node:alpine base image
    return ``;
  }

  initScript(): string {
    // Aldready preconfigured in javascript package
    return ``;
  }
}
