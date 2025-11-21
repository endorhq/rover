import { SandboxPackage } from '../types.js';

export class YarnSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'yarn';

  installScript(): string {
    // yarn is typically included in node:alpine, but ensure it's installed
    return `npm install -g yarn`;
  }

  initScript(): string {
    // Configure yarn to install global binaries locally for the user
    return `mkdir -p ~/.yarn/bin;
yarn config set prefix ~/.yarn;
echo 'export PATH="$HOME/.yarn/bin:$PATH"' >> ~/.profile;
source ~/.profile`;
  }
}
