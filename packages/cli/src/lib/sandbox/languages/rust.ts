import { SandboxPackage } from '../types.js';

export class RustSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'rust';

  installScript(): string {
    // Install rust
    return `sudo apk add --no-cache rustup
rustup-init -y`;
  }

  initScript(): string {
    // Add the cargo env to the profile
    return `echo '. "$HOME/.cargo/env"' >> $HOME/.profile
source $HOME/.profile`;
  }
}
