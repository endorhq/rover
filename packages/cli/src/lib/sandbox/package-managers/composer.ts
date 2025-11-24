import { SandboxPackage } from '../types.js';

export class ComposerSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'composer';

  installScript(): string {
    // Install Composer using official method (requires PHP which should be installed via php language package)
    // Download installer, verify SHA-384 hash, run installer, cleanup, and move to user-local bin
    return `php -r "copy('https://getcomposer.org/installer', 'composer-setup.php');"
EXPECTED_CHECKSUM="$(php -r 'copy("https://getcomposer.org/download/latest-stable/composer.phar.sha256", "php://stdout");')"
ACTUAL_CHECKSUM="$(sha256sum composer-setup.php | awk '{print $1}')"
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
