import { SandboxPackage } from '../types.js';

export class DartSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'dart';

  installScript(): string {
    // Install Flutter SDK (includes Dart SDK)
    return `git clone --depth 1 --branch stable https://github.com/flutter/flutter.git $HOME/.flutter`;
  }

  initScript(): string {
    // Add Flutter and Dart to PATH, skip flutter precache as the Dart SDK
    // is already downloaded during the Flutter tool build step.
    // Using direct SDK paths avoids Flutter wrapper update checks and lock acquisition.
    return `echo 'export PATH="$HOME/.flutter/bin:$HOME/.flutter/bin/cache/dart-sdk/bin:$HOME/.pub-cache/bin:$PATH"' >> $HOME/.profile
echo 'export FLUTTER_GIT_URL=""' >> $HOME/.profile
source $HOME/.profile`;
  }
}
