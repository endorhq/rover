import { ProcessManager } from 'rover-common';

import { TaskDescription } from '../description.js';

export abstract class Sandbox {
  abstract backend: string;

  processManager?: ProcessManager;
  task: TaskDescription;

  constructor(task: TaskDescription, processManager?: ProcessManager) {
    this.task = task;
    this.processManager = processManager;
  }

  abstract isBackendAvailable(): Promise<boolean>;
  protected abstract create(): Promise<string>;
  protected abstract start(): Promise<string>;
  protected abstract remove(): Promise<string>;
  protected abstract stop(): Promise<string>;
  protected abstract logs(): Promise<string>;
  protected abstract followLogs(): AsyncIterable<string>;
  protected abstract openShellAtWorktree(): Promise<void>;

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
    } catch (_err) {
      this.processManager?.failLastItem();
    }
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
}
