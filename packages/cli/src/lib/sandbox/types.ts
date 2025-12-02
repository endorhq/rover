import { launch, ProcessManager } from 'rover-common';
import { ProjectConfigManager, TaskDescriptionManager } from 'rover-schemas';
import { AIAgentTool } from '../agents/index.js';
import {
  loadEnvsFile,
  parseCustomEnvironmentVariables,
} from '../../utils/env-variables.js';

export abstract class SandboxPackage {
  abstract name: string;

  abstract installScript(): string;
  abstract initScript(): string;
}

export abstract class Sandbox {
  abstract backend: string;

  processManager?: ProcessManager;
  task: TaskDescriptionManager;

  constructor(task: TaskDescriptionManager, processManager?: ProcessManager) {
    this.task = task;
    this.processManager = processManager;
  }

  abstract isBackendAvailable(): Promise<boolean>;
  abstract openShellAtWorktree(): Promise<void>;

  protected abstract create(): Promise<string>;
  protected abstract start(): Promise<string>;
  protected abstract remove(): Promise<string>;
  protected abstract stop(): Promise<string>;
  protected abstract logs(): Promise<string>;
  protected abstract followLogs(): AsyncIterable<string>;

  abstract runInteractive(
    initialPrompt?: string
  ): Promise<ReturnType<typeof launch>>;

  protected get sandboxName(): string {
    return `rover-task-${this.task.id}-${this.task.iterations}`;
  }

  async createAndStart(): Promise<string> {
    let sandboxId = '';
    this.processManager?.addItem(
      `Prepare sandbox (${this.backend}) | Name: ${this.sandboxName}`
    );
    try {
      sandboxId = await this.create();
      this.processManager?.completeLastItem();
      this.processManager?.addItem(
        `Start sandbox (${this.backend}) | Name: ${this.sandboxName}`
      );
      await this.start();
      this.processManager?.completeLastItem();
    } catch (err) {
      this.processManager?.failLastItem();
      this.processManager?.finish();
      throw err;
    }
    this.processManager?.finish();
    return sandboxId;
  }

  async stopAndRemove(): Promise<string> {
    let sandboxId = '';
    this.processManager?.addItem(
      `Stopping sandbox (${this.backend}) | Name: ${this.sandboxName}`
    );
    try {
      sandboxId = await this.stop();
      this.processManager?.completeLastItem();
    } catch (_err: any) {
      this.processManager?.failLastItem();
    } finally {
      this.processManager?.finish();
    }

    this.processManager?.addItem(
      `Removing sandbox (${this.backend}) | Name: ${this.sandboxName}`
    );

    try {
      sandboxId = await this.remove();
      this.processManager?.completeLastItem();
    } catch (_err: any) {
      this.processManager?.failLastItem();
    } finally {
      this.processManager?.finish();
    }

    return sandboxId;
  }

  /**
   * Load the sandbox environment variables from the project configuration
   * and the AI agent default environment vars.
   */
  getSandboxEnvironmentVariables(
    agent: AIAgentTool,
    projectConfig: ProjectConfigManager | undefined
  ): string[] {
    const envVariables: string[] = agent.getEnvironmentVariables();

    // Load project config and merge custom environment variables
    let customEnvVariables: string[] = [];

    if (projectConfig) {
      try {
        // Parse custom envs array
        if (projectConfig.envs && projectConfig.envs.length > 0) {
          customEnvVariables = parseCustomEnvironmentVariables(
            projectConfig.envs
          );
        }

        // Load envs from file
        if (projectConfig.envsFile) {
          const fileEnvVariables = loadEnvsFile(projectConfig);
          customEnvVariables = [...customEnvVariables, ...fileEnvVariables];
        }
      } catch (error) {
        // Silently skip if there's an error loading project config
      }
    }

    // Merge agent environment variables with custom environment variables
    // IMPORTANT: Custom environment variables are appended after agent defaults.
    // In Podman, when the same environment variable appears multiple times, the last
    // occurrence takes precedence. This means custom environment variables will
    // override agent defaults if there are conflicts, which is the desired behavior.
    return [...envVariables, ...customEnvVariables];
  }
}
