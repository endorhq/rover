import { SandboxPackage } from '../types.js';

export class UvSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'uv';

  installScript(): string {
    // Already preinstalled in the image for MCPs
    return ``;
  }

  initScript(): string {
    return ``;
  }
}
