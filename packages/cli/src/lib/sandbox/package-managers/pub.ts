import { SandboxPackage } from '../types.js';

export class PubSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'pub';

  installScript(): string {
    // pub is bundled with the Dart/Flutter SDK, no additional installation needed
    return ``;
  }

  initScript(): string {
    // pub environment is already configured by the dart language package
    return ``;
  }
}
