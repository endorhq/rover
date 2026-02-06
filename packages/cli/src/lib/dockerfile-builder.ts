/**
 * DockerfileBuilder - Generates Dockerfile.rover for pre-built custom images
 *
 * This module provides functionality to generate a Dockerfile that pre-installs
 * all detected languages, package managers, and task managers for a project.
 * The resulting image can be used to speed up task execution by avoiding
 * runtime installation of dependencies.
 */

import { basename } from 'node:path';
import { ProjectConfigManager } from 'rover-core';
import type { SandboxPackage } from './sandbox/types.js';
import { getDefaultAgentImage } from './sandbox/container-common.js';

// Language packages
import { JavaScriptSandboxPackage } from './sandbox/languages/javascript.js';
import { TypeScriptSandboxPackage } from './sandbox/languages/typescript.js';
import { PHPSandboxPackage } from './sandbox/languages/php.js';
import { RustSandboxPackage } from './sandbox/languages/rust.js';
import { GoSandboxPackage } from './sandbox/languages/go.js';
import { PythonSandboxPackage } from './sandbox/languages/python.js';
import { RubySandboxPackage } from './sandbox/languages/ruby.js';

// Package manager packages
import { NpmSandboxPackage } from './sandbox/package-managers/npm.js';
import { PnpmSandboxPackage } from './sandbox/package-managers/pnpm.js';
import { YarnSandboxPackage } from './sandbox/package-managers/yarn.js';
import { ComposerSandboxPackage } from './sandbox/package-managers/composer.js';
import { CargoSandboxPackage } from './sandbox/package-managers/cargo.js';
import { GomodSandboxPackage } from './sandbox/package-managers/gomod.js';
import { PipSandboxPackage } from './sandbox/package-managers/pip.js';
import { PoetrySandboxPackage } from './sandbox/package-managers/poetry.js';
import { UvSandboxPackage } from './sandbox/package-managers/uv.js';
import { RubygemsSandboxPackage } from './sandbox/package-managers/rubygems.js';

// Task manager packages
import { JustSandboxPackage } from './sandbox/task-managers/just.js';
import { MakeSandboxPackage } from './sandbox/task-managers/make.js';
import { TaskSandboxPackage } from './sandbox/task-managers/task.js';

/**
 * Check if a script contains shell control structures that can't be
 * safely split into && chains.
 */
function hasShellControlStructures(script: string): boolean {
  // Match shell control keywords at word boundaries
  const controlPatterns = [
    /\bif\b.*\bthen\b/s, // if...then
    /\bfor\b.*\bdo\b/s, // for...do
    /\bwhile\b.*\bdo\b/s, // while...do
    /\bcase\b.*\bin\b/s, // case...in
    /\bfi\b/, // end of if
    /\bdone\b/, // end of for/while
    /\besac\b/, // end of case
  ];
  return controlPatterns.some(pattern => pattern.test(script));
}

/**
 * Format a shell script for use in a Dockerfile RUN command.
 * Converts multi-line scripts with semicolons into proper && chains,
 * unless the script contains shell control structures.
 */
function formatScriptForDockerfile(script: string): string {
  const trimmed = script.trim();

  if (trimmed.length === 0) {
    return '';
  }

  // If script contains control structures (if/then/fi, for/do/done, etc.),
  // use bash -c with the script as-is to preserve the structure
  if (hasShellControlStructures(trimmed)) {
    // Escape single quotes in the script for bash -c '...'
    const escaped = trimmed.replace(/'/g, "'\"'\"'");
    return `bash -c '${escaped}'`;
  }

  // Normalize line endings and split into commands
  // Handle both newlines and semicolons as command separators
  const commands = trimmed
    .split(/[;\n]+/)
    .map(cmd => cmd.trim())
    .filter(cmd => cmd.length > 0);

  if (commands.length === 0) {
    return '';
  }

  if (commands.length === 1) {
    return commands[0];
  }

  // Join with && and proper line continuation
  return commands.join(' \\\n    && ');
}

export interface DockerfileBuilderOptions {
  /** Include dependency installation commands (npm install, etc.) */
  installDeps?: boolean;
  /** Custom base image override */
  baseImage?: string;
  /** Pre-install AI agent CLIs (claude, gemini, etc.) */
  withAgents?: string[];
}

/**
 * Get language sandbox packages based on project configuration
 */
export function getLanguagePackages(
  projectConfig: ProjectConfigManager
): SandboxPackage[] {
  const packages: SandboxPackage[] = [];

  for (const language of projectConfig.languages) {
    switch (language) {
      case 'javascript':
        packages.push(new JavaScriptSandboxPackage());
        break;
      case 'typescript':
        packages.push(new TypeScriptSandboxPackage());
        break;
      case 'php':
        packages.push(new PHPSandboxPackage());
        break;
      case 'rust':
        packages.push(new RustSandboxPackage());
        break;
      case 'go':
        packages.push(new GoSandboxPackage());
        break;
      case 'python':
        packages.push(new PythonSandboxPackage());
        break;
      case 'ruby':
        packages.push(new RubySandboxPackage());
        break;
    }
  }

  return packages;
}

/**
 * Get package manager sandbox packages based on project configuration
 */
export function getPackageManagerPackages(
  projectConfig: ProjectConfigManager
): SandboxPackage[] {
  const packages: SandboxPackage[] = [];

  for (const packageManager of projectConfig.packageManagers) {
    switch (packageManager) {
      case 'npm':
        packages.push(new NpmSandboxPackage());
        break;
      case 'pnpm':
        packages.push(new PnpmSandboxPackage());
        break;
      case 'yarn':
        packages.push(new YarnSandboxPackage());
        break;
      case 'composer':
        packages.push(new ComposerSandboxPackage());
        break;
      case 'cargo':
        packages.push(new CargoSandboxPackage());
        break;
      case 'gomod':
        packages.push(new GomodSandboxPackage());
        break;
      case 'pip':
        packages.push(new PipSandboxPackage());
        break;
      case 'poetry':
        packages.push(new PoetrySandboxPackage());
        break;
      case 'uv':
        packages.push(new UvSandboxPackage());
        break;
      case 'rubygems':
        packages.push(new RubygemsSandboxPackage());
        break;
    }
  }

  return packages;
}

/**
 * Get task manager sandbox packages based on project configuration
 */
export function getTaskManagerPackages(
  projectConfig: ProjectConfigManager
): SandboxPackage[] {
  const packages: SandboxPackage[] = [];

  for (const taskManager of projectConfig.taskManagers) {
    switch (taskManager) {
      case 'just':
        packages.push(new JustSandboxPackage());
        break;
      case 'make':
        packages.push(new MakeSandboxPackage());
        break;
      case 'task':
        packages.push(new TaskSandboxPackage());
        break;
    }
  }

  return packages;
}

/**
 * DockerfileBuilder generates Dockerfile.rover content for custom project images
 */
export class DockerfileBuilder {
  private projectConfig: ProjectConfigManager;
  private options: DockerfileBuilderOptions;

  constructor(
    projectConfig: ProjectConfigManager,
    options: DockerfileBuilderOptions = {}
  ) {
    this.projectConfig = projectConfig;
    this.options = options;
  }

  /**
   * Get the base image to use for the Dockerfile
   */
  getBaseImage(): string {
    return this.options.baseImage || getDefaultAgentImage();
  }

  /**
   * Get the default image tag for this project
   */
  getImageTag(): string {
    const projectName = basename(this.projectConfig.projectRoot)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-');
    return `rover-${projectName}:latest`;
  }

  /**
   * Generate the Dockerfile content
   */
  generate(): string {
    const baseImage = this.getBaseImage();
    const projectName = basename(this.projectConfig.projectRoot);

    const languagePackages = getLanguagePackages(this.projectConfig);
    const packageManagerPackages = getPackageManagerPackages(
      this.projectConfig
    );
    const taskManagerPackages = getTaskManagerPackages(this.projectConfig);

    const lines: string[] = [
      '# Generated by: rover image build',
      '# Regenerate with: rover image build --force',
      '',
      `ARG BASE_IMAGE=${baseImage}`,
      'FROM ${BASE_IMAGE}',
      '',
      '# Ensure node group (gid=1000) has passwordless sudo access',
      '# This is needed when the container runs with --user matching host uid/gid',
      "RUN echo '%node ALL=(ALL) NOPASSWD: ALL' >> /etc/sudoers.d/node-group",
      '',
    ];

    // Collect all apt-get install commands
    const aptPackages: string[] = [];
    const otherInstallCommands: string[] = [];
    const initCommands: string[] = [];

    const allPackages = [
      ...languagePackages,
      ...packageManagerPackages,
      ...taskManagerPackages,
    ];

    for (const pkg of allPackages) {
      const installScript = pkg.installScript().trim();
      if (installScript) {
        // Parse apt-get install commands to combine them
        const aptMatch = installScript.match(
          /sudo\s+apt-get\s+install\s+-y\s+--no-install-recommends\s+(.+)/
        );
        if (aptMatch) {
          // Extract package names (split by whitespace, handle multi-line)
          const pkgNames = aptMatch[1].split(/\s+/).filter(p => p.length > 0);
          aptPackages.push(...pkgNames);
        } else {
          // Non-apt commands need to be run separately
          otherInstallCommands.push(`# Install ${pkg.name}`);
          otherInstallCommands.push(
            `RUN ${formatScriptForDockerfile(installScript)}`
          );
          otherInstallCommands.push('');
        }
      }

      const initScript = pkg.initScript().trim();
      if (initScript) {
        initCommands.push(`# Initialize ${pkg.name}`);
        initCommands.push(`RUN ${formatScriptForDockerfile(initScript)}`);
        initCommands.push('');
      }
    }

    // Add combined apt-get install if any packages were found
    if (aptPackages.length > 0) {
      lines.push('# Install system packages');
      lines.push(
        'RUN apt-get update && apt-get install -y --no-install-recommends \\'
      );
      for (const pkg of aptPackages) {
        lines.push(`    ${pkg} \\`);
      }
      lines.push('    && rm -rf /var/lib/apt/lists/*');
      lines.push('');
    }

    // Add non-apt install commands
    if (otherInstallCommands.length > 0) {
      lines.push(...otherInstallCommands);
    }

    // Add init commands
    if (initCommands.length > 0) {
      lines.push(...initCommands);
    }

    // Add agent installation if requested
    if (this.options.withAgents && this.options.withAgents.length > 0) {
      lines.push('# Pre-install agent CLI(s)');

      const agentPackages: string[] = [];
      for (const agent of this.options.withAgents) {
        switch (agent) {
          case 'claude':
            agentPackages.push('@anthropic-ai/claude-code@latest');
            break;
          case 'gemini':
            agentPackages.push('@google/gemini-cli@latest');
            break;
          case 'codex':
            agentPackages.push('@openai/codex@latest');
            break;
          case 'qwen':
            agentPackages.push('@qwen-code/qwen-code@latest');
            break;
          default:
            lines.push(`# Unknown agent: ${agent} - skipping`);
        }
      }

      if (agentPackages.length > 0) {
        lines.push(`RUN npm install -g ${agentPackages.join(' ')}`);
      }
      lines.push('');
    }

    // Add labels
    lines.push('# Labels for identification');
    lines.push('LABEL rover.generated=true');
    lines.push(`LABEL rover.project="${projectName}"`);

    return lines.join('\n');
  }
}
