import { SandboxPackage } from '../types.js';

export class RustSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'rust';

  installScript(): string {
    // Install rust
    return `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y`;
  }

  initScript(): string {
    // Add the cargo env to the profile
    return `echo '. "$HOME/.cargo/env"' >> $HOME/.profile
source $HOME/.profile`;
  }
}
