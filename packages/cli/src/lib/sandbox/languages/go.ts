import { SandboxPackage } from '../types.js';

export class GoSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'go';

  installScript(): string {
    // Install go
    return `sudo apt-get install -y --no-install-recommends golang-go`;
  }

  initScript(): string {
    // Add the go env to the profile
    return `mkdir -p $HOME/go/bin
echo 'export PATH="$HOME/go/bin:$PATH"' >> $HOME/.profile
echo 'export GOPATH="$HOME/go"' >> $HOME/.profile
source $HOME/.profile
# Verify go is accessible
if ! go version > /dev/null 2>&1; then
  echo "⚠ Warning: go binary is not accessible, attempting to fix permissions"
  GO_PATH=$(which go 2>/dev/null || echo "")
  if [ -n "$GO_PATH" ]; then
    sudo chmod +x "$GO_PATH" 2>/dev/null || true
  fi
fi`;
  }
}
