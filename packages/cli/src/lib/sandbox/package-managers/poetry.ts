import { SandboxPackage } from '../types.js';

export class PoetrySandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'poetry';

  installScript(): string {
    // Install Poetry using the official installer (requires Python)
    return `curl -sSL https://install.python-poetry.org | python3 -`;
  }

  initScript(): string {
    return ``;
  }
}
