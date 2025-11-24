import { SandboxPackage } from '../types.js';

export class CargoSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'cargo';

  installScript(): string {
    // cargo is installed via rustup in the rust language package
    return ``;
  }

  initScript(): string {
    // cargo environment is already configured by rust language package
    return ``;
  }
}
