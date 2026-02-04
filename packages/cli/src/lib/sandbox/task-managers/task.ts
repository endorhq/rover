import { SandboxPackage } from '../types.js';

export class TaskSandboxPackage extends SandboxPackage {
  // Name of the package
  name = 'task';

  installScript(): string {
    // Install Task (go-task) - a task runner / build tool written in Go
    // Download the install script and run it
    return `curl --location https://taskfile.dev/install.sh | bash`;
  }

  initScript(): string {
    return ``;
  }
}
