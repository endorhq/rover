import { SandboxPackage } from '../types.js';

export class ComposerSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'composer';

  installScript(): string {
    // Install Composer using official method (requires PHP which should be installed via php language package)
    // Download installer, verify SHA-384 hash, run installer, cleanup, and move to user-local bin
    // Note: The installer checksum is at installer.sig, not the phar checksum
    return `php -r "copy('https://getcomposer.org/installer', 'composer-setup.php');"
EXPECTED_CHECKSUM="$(php -r 'copy("https://composer.github.io/installer.sig", "php://stdout");')"
ACTUAL_CHECKSUM="$(php -r 'echo hash_file("sha384", "composer-setup.php");')"
if [ "$EXPECTED_CHECKSUM" != "$ACTUAL_CHECKSUM" ]; then
    >&2 echo 'ERROR: Invalid installer checksum'
    rm composer-setup.php
    exit 1
fi
php composer-setup.php --quiet
rm composer-setup.php
mkdir -p $HOME/.local/bin
mv composer.phar $HOME/.local/bin/composer`;
  }

  initScript(): string {
    // Configure Composer to use user-local paths
    return ``;
  }
}
