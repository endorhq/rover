import { SandboxPackage } from '../types.js';

export class GoSandboxPackage extends SandboxPackage {
    // Name of the package
    name = 'go';

    installScript(): string {
        // Install go
        return `sudo apk add --no-cache go`;
    }

    initScript(): string {
        // Add the go env to the profile
        return `mkdir -p ~/go/bin
echo 'export PATH="$HOME/go/bin:$PATH"' >> ~/.profile
echo 'export GOPATH="$HOME/go"' >> ~/.profile
source ~/.profile`;
    }
}