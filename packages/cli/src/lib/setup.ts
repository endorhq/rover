import { writeFileSync, chmodSync, mkdirSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TaskDescription } from './description.js';
import { findProjectRoot, launchSync, VERBOSE } from 'rover-common';
import workflowDistPath from './workflows/swe.yml';
import entrypointScript from './entrypoint.sh';
import pupa from 'pupa';
import { fileURLToPath } from 'node:url';

/**
 * SetupBuilder class - Consolidates Docker setup script generation
 * Replaces the existing docker-setup.sh and docker-setup-gemini.sh files
 */
export class SetupBuilder {
  private agent: string;
  private taskId: number;
  private isDockerRootless: boolean;

  constructor(taskDescription: TaskDescription, agent: string) {
    this.agent = agent;
    this.taskId = taskDescription.id;

    let isDockerRootless = false;

    const dockerInfo = launchSync('docker', ['info', '-f', 'json']).stdout;
    if (dockerInfo) {
      const info = JSON.parse(dockerInfo.toString());
      isDockerRootless = (info?.SecurityOptions || []).some((value: string) =>
        value.includes('rootless')
      );
    }

    this.isDockerRootless = isDockerRootless;
  }

  /**
   * Generate and save the setup script to the appropriate task directory
   */
  generateEntrypoint(): string {
    // Ensure task directory exists
    const taskDir = join(
      findProjectRoot(),
      '.rover',
      'tasks',
      this.taskId.toString()
    );
    mkdirSync(taskDir, { recursive: true });

    let recoverPermissions = '';

    // For Docker rootless, force it to return the permissions to the right users.
    if (this.isDockerRootless) {
      recoverPermissions = `\n    sudo chown -R root:root /workspace || true
    sudo chown -R root:root /output || true\n`;
    }

    // Generate script content
    const scriptContent = pupa(entrypointScript, {
      agent: this.agent,
      recoverPermissions,
    });

    // Write script to file
    const scriptPath = join(taskDir, 'entrypoint.sh');
    writeFileSync(scriptPath, scriptContent, 'utf8');

    // Make script executable
    chmodSync(scriptPath, 0o755);

    return scriptPath;
  }

  /**
   * Save the workflow file into the target task.
   * TODO: Support multiple workflows
   */
  saveWorkflow(): string {
    // Ensure task directory exists
    const taskDir = join(
      findProjectRoot(),
      '.rover',
      'tasks',
      this.taskId.toString()
    );
    mkdirSync(taskDir, { recursive: true });

    // Write script to file
    const workflowTaskPath = join(taskDir, 'workflow.yml');
    const distDir = dirname(fileURLToPath(import.meta.url));
    const workflowPath = join(distDir, workflowDistPath);
    cpSync(workflowPath, workflowTaskPath);

    return workflowTaskPath;
  }

  /**
   * Get the path where the setup script will be saved
   */
  getScriptPath(script: string): string {
    return join(
      findProjectRoot(),
      '.rover',
      'tasks',
      this.taskId.toString(),
      script
    );
  }

  /**
   * Static factory method to create and generate setup script
   */
  static generate(taskDescription: TaskDescription, agent: string): string {
    const builder = new SetupBuilder(taskDescription, agent);
    return builder.generateEntrypoint();
  }
}
