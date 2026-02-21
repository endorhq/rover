import { SandboxPackage } from '../types.js';

export class DartSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'dart';

  installScript(): string {
    // Install Flutter SDK (includes Dart SDK)
    return `git clone --depth 1 --branch stable https://github.com/flutter/flutter.git $HOME/.flutter`;
  }

  initScript(): string {
    // Add Flutter and Dart to PATH
    return `echo 'export PATH="$HOME/.flutter/bin:$HOME/.flutter/bin/cache/dart-sdk/bin:$HOME/.pub-cache/bin:$PATH"' >> $HOME/.profile
source $HOME/.profile
flutter precache`;
  }
}
