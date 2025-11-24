import { SandboxPackage } from '../types.js';

export class RubygemsSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'rubygems';

  installScript(): string {
    // Install bundler
    return `gem install bundler`;
  }

  initScript(): string {
    // Configure it to use a local folder by default
    return `mkdir -p $HOME/.bundle
bundle config set --global path $HOME/.bundle`;
  }
}
