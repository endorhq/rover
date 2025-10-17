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
  private task: TaskDescription;
  private taskDir: string;
  private isDockerRootless: boolean;

  constructor(taskDescription: TaskDescription, agent: string) {
    this.agent = agent;
    this.task = taskDescription;

    let isDockerRootless = false;

    const dockerInfo = launchSync('docker', ['info', '-f', 'json']).stdout;
    if (dockerInfo) {
      const info = JSON.parse(dockerInfo.toString());
      isDockerRootless = (info?.SecurityOptions || []).some((value: string) =>
        value.includes('rootless')
      );
    }

    this.isDockerRootless = isDockerRootless;

    // Ensures the task directory exists
    const taskDir = join(
      findProjectRoot(),
      '.rover',
      'tasks',
      this.task.id.toString()
    );
    mkdirSync(taskDir, { recursive: true });

    this.taskDir = taskDir;
  }

  /**
   * Generate and save the setup script to the appropriate task directory
   */
  generateEntrypoint(): string {
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
    const scriptPath = join(this.taskDir, 'entrypoint.sh');
    writeFileSync(scriptPath, scriptContent.replace(/\r\n/g, '\n'), 'utf8');

    // Make script executable
    chmodSync(scriptPath, 0o755);

    return scriptPath;
  }

  /**
   * Generate the inputs file to store task inputs and simplify loading them.
   */
  generateInputs(): string {
    // For now, we only pass the task title and description as inputs
    const inputs = {
      title: this.task.title,
      description: this.task.description,
    };

    const inputsPath = join(this.taskDir, 'inputs.json');
    writeFileSync(inputsPath, JSON.stringify(inputs, null, 2), 'utf-8');

    return inputsPath;
  }

  /**
   * Save the workflow file into the target task.
   * TODO: Support multiple workflows
   */
  saveWorkflow(): string {
    // Write script to file
    const workflowTaskPath = join(this.taskDir, 'workflow.yml');
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
      this.task.id.toString(),
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
