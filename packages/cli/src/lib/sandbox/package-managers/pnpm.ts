import { SandboxPackage } from '../types.js';

export class PnpmSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'pnpm';

  installScript(): string {
    // Install pnpm using npm
    return `npm install -g pnpm`;
  }

  initScript(): string {
    // pnpm automatically uses user-local directories
    return ``;
  }
}
