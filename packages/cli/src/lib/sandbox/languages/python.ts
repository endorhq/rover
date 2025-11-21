import { SandboxPackage } from '../types.js';

export class PythonSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'python';

  installScript(): string {
    // Install python-dev. Python is already installed in the base image
    return `sudo apk add --no-cache python3-dev
sudo ln -sf python3 /usr/bin/python`;
  }

  initScript(): string {
    return ``;
  }
}
