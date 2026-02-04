import { SandboxPackage } from '../types.js';

export class PoetrySandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'poetry';

  installScript(): string {
    return `sudo apt-get install -y --no-install-recommends python3-poetry`;
  }

  initScript(): string {
    return ``;
  }
}
