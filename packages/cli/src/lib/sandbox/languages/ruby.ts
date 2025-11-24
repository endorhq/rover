import { SandboxPackage } from '../types.js';

export class RubySandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'ruby';

  installScript(): string {
    // Install ruby. If build base is required, the agent will take care of installing it
    return `sudo apk add --no-cache ruby ruby-dev`;
  }

  initScript(): string {
    // Configure gem to avoid installing documentation and set user install path
    return `echo "gem: --no-document --user-install" > $HOME/.gemrc
echo 'export PATH="$(ruby -e "puts Gem.user_dir")/bin:$PATH"' >> $HOME/.profile
source $HOME/.profile`;
  }
}
