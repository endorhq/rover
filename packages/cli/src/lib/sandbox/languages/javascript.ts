import { SandboxPackage } from '../types.js';

export class JavaScriptSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'javascript';

  installScript(): string {
    // Nothing required here.
    return ``;
  }

  initScript(): string {
    // Configure node to install global modules locally for the user
    return `mkdir -p $HOME/.local/npm;
echo "prefix=$HOME/.local/npm" >> $HOME/.npmrc;
echo 'export PATH="$HOME/.local/npm/bin:$PATH"' >> $HOME/.profile;
source $HOME/.profile`;
  }
}
