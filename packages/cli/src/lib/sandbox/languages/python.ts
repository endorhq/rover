import { SandboxPackage } from '../types.js';

export class PythonSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'python';

  installScript(): string {
    // Install python-dev. Python is already installed in the base image
    return `sudo apt-get install -y --no-install-recommends python3-dev
sudo ln -sf python3 /usr/bin/python`;
  }

  initScript(): string {
    return ``;
  }
}
