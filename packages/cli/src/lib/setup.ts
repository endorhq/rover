import {
  writeFileSync,
  chmodSync,
  mkdirSync,
  cpSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  TaskDescriptionManager,
  IterationManager,
  PreContextDataManager,
  type PreviousIteration,
} from 'rover-schemas';
import { findProjectRoot, launchSync, VERBOSE } from 'rover-common';
import sweWorkflow from './workflows/swe.yml';
import techWriterWorkflow from './workflows/tech-writer.yml';
import entrypointScript from './entrypoint.sh';
import pupa from 'pupa';
import { fileURLToPath } from 'node:url';
import { ProjectConfigManager } from 'rover-schemas';
import type { SandboxPackage } from './sandbox/types.js';

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
 * SetupBuilder class - Consolidates Docker setup script generation
 * Replaces the existing docker-setup.sh and docker-setup-gemini.sh files
 */
export class SetupBuilder {
  private agent: string;
  private task: TaskDescriptionManager;
  private taskDir: string;
  private isDockerRootless: boolean;
  private projectConfig: ProjectConfigManager;

  constructor(
    taskDescription: TaskDescriptionManager,
    agent: string,
    projectConfig: ProjectConfigManager
  ) {
    this.agent = agent;
    this.task = taskDescription;
    this.projectConfig = projectConfig;

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
   * Get language sandbox packages based on project configuration
   */
  private getLanguagePackages(): SandboxPackage[] {
    const packages: SandboxPackage[] = [];

    for (const language of this.projectConfig.languages) {
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
  private getPackageManagerPackages(): SandboxPackage[] {
    const packages: SandboxPackage[] = [];

    for (const packageManager of this.projectConfig.packageManagers) {
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
  private getTaskManagerPackages(): SandboxPackage[] {
    const packages: SandboxPackage[] = [];

    for (const taskManager of this.projectConfig.taskManagers) {
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
   * Generate and save the setup script to the appropriate task directory
   */
  generateEntrypoint(
    includeTaskSetup: boolean = true,
    entrypointFilename: string = 'entrypoint.sh'
  ): string {
    let recoverPermissions = '';

    // For Docker rootless, force it to return the permissions to the right users.
    if (this.isDockerRootless) {
      recoverPermissions = `\n    sudo chown -R root:root /workspace || true
    sudo chown -R root:root /output || true\n`;
    }

    // Generate installation scripts for languages, package managers, and task managers
    const languagePackages = this.getLanguagePackages();
    const packageManagerPackages = this.getPackageManagerPackages();
    const taskManagerPackages = this.getTaskManagerPackages();

    let installAllPackages = '';
    const allPackages = [
      ...languagePackages,
      ...packageManagerPackages,
      ...taskManagerPackages,
    ];

    if (allPackages.length > 0) {
      const installScripts: string[] = [];

      for (const pkg of allPackages) {
        const script = pkg.installScript();
        if (script.trim()) {
          installScripts.push(`echo "📦 Installing ${pkg.name}..."`);
          installScripts.push(script);
          installScripts.push(`if [ $? -eq 0 ]; then
  echo "✅ ${pkg.name} installed successfully"
else
  echo "❌ Failed to install ${pkg.name}"
  safe_exit 1
fi`);
        }

        const initScript = pkg.initScript();
        if (initScript.trim()) {
          installScripts.push(`echo "🔧 Initializing ${pkg.name}..."`);
          installScripts.push(initScript);
          installScripts.push(`if [ $? -eq 0 ]; then
  echo "✅ ${pkg.name} initialized successfully"
else
  echo "❌ Failed to initialize ${pkg.name}"
  safe_exit 1
fi`);
        }
      }

      if (installScripts.length > 0) {
        installAllPackages = `
echo -e "\\n======================================="
echo "📦 Installing Languages, Package Managers, and Task Managers"
echo "======================================="
${installScripts.join('\n')}
`;
      }
    }

    // Generate MCP configuration commands from rover.json
    const mcps = this.projectConfig.mcps;
    let configureAllMCPCommands: string[] = [];

    if (mcps && mcps.length > 0) {
      configureAllMCPCommands.push('echo "✅ Configuring custom MCPs"');
      for (const mcp of mcps) {
        const transport = mcp.transport || 'stdio';
        let cmd = `rover-agent config mcp ${this.agent} "${mcp.name}" --transport "${mcp.transport}"`;

        if (mcp.envs && mcp.envs.length > 0) {
          for (const env of mcp.envs) {
            cmd += ` --env "${env}"`;
          }
        }

        if (mcp.headers && mcp.headers.length > 0) {
          for (const header of mcp.headers) {
            cmd += ` --header "${header}"`;
          }
        }

        cmd += ` "${mcp.commandOrUrl}"`;

        configureAllMCPCommands.push(cmd);
      }
    } else {
      configureAllMCPCommands.push(
        'echo "✅ No MCPs defined in rover.json, skipping custom MCP configuration"'
      );
    }

    // Generate initScript execution code if initScript is provided
    let initScriptExecution = '';
    if (this.projectConfig.initScript) {
      initScriptExecution = `
echo -e "\\n======================================="
echo "🔧 Running initialization script"
echo "======================================="
chmod +x /init-script.sh
/bin/sh /init-script.sh
if [ $? -eq 0 ]; then
  echo "✅ Initialization script completed successfully"
else
  echo "❌ Initialization script failed"
  safe_exit 1
fi
`;
    }

    // Generate template variables for task-related sections
    const validateTaskFileFunction = includeTaskSetup
      ? `
# Function to validate task description file
validate_task_file() {
    if [ ! -f "/task/description.json" ]; then
        echo "❌ Task description file not found at /task/description.json"
        safe_exit 1
    fi
}
`
      : '';

    const validateTaskFileCall = includeTaskSetup
      ? `
# Validate task description file
validate_task_file`
      : '';

    const taskDataSection = includeTaskSetup
      ? `
# Read task data from mounted JSON file
TASK_ID=$(jq -r '.id' /task/description.json)
TASK_ITERATION=$(jq -r '.iteration' /task/description.json)
TASK_TITLE=$(jq -r '.title' /task/description.json)
TASK_DESCRIPTION=$(jq -r '.description' /task/description.json)

echo -e "\\n======================================="
echo "🚀 Rover Task Execution Setup"
echo "======================================="
echo "Task Title: $TASK_TITLE"
echo "Task ID: $TASK_ID"
echo "Task Iteration: $TASK_ITERATION"
echo "======================================="
`
      : '';

    const exportTaskVariables = includeTaskSetup
      ? `
# Export variables for agent execution
export TASK_ID TASK_TITLE TASK_DESCRIPTION
`
      : '';

    const workflowExecutionSection = includeTaskSetup
      ? `
# Execute the complete task workflow
echo -e "\\n======================================="
echo "🚀 Running Workflow"
echo "======================================="
`
      : '';

    // Generate script content
    const scriptContent = pupa(entrypointScript, {
      agent: this.agent,
      configureAllMCPCommands: configureAllMCPCommands.join('\n  '),
      recoverPermissions,
      installAllPackages,
      initScriptExecution,
      validateTaskFileFunction,
      validateTaskFileCall,
      taskDataSection,
      exportTaskVariables,
      workflowExecutionSection,
    });

    // Write script to file
    const scriptPath = join(this.taskDir, entrypointFilename);
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
   */
  saveWorkflow(workflowName: string): string {
    // Write script to file
    const workflowTaskPath = join(this.taskDir, 'workflow.yml');
    const distDir = dirname(fileURLToPath(import.meta.url));
    let workflowPath;

    switch (workflowName) {
      case 'tech-writer': {
        workflowPath = join(distDir, techWriterWorkflow);
        break;
      }
      default: {
        workflowPath = join(distDir, sweWorkflow);
      }
    }
    cpSync(workflowPath, workflowTaskPath);

    return workflowTaskPath;
  }

  /**
   * Generate pre-context files with task and iteration information
   * These files are used by the agent to inject context into the workflow
   * Returns an array of file paths
   */
  generatePreContextFiles(): string[] {
    const iterationsPath = this.task.iterationsPath();
    const currentIteration = this.task.iterations;

    // Get initial task info from iteration 1
    let initialTask = {
      title: this.task.title,
      description: this.task.description,
    };

    const firstIterationPath = join(iterationsPath, '1');
    if (existsSync(firstIterationPath)) {
      try {
        const firstIteration = IterationManager.load(firstIterationPath);
        initialTask = {
          title: firstIteration.title,
          description: firstIteration.description,
        };
      } catch (error) {
        // If we can't load iteration 1, use task description as fallback
        if (VERBOSE) {
          console.error('Failed to load iteration 1 for pre-context:', error);
        }
      }
    }

    // Gather previous iterations (only first and last before current)
    const previousIterations: PreviousIteration[] = [];

    // Only include iterations if there are at least 2 iterations before current
    if (currentIteration > 1) {
      // Always include iteration 1 if it's not the current iteration
      if (currentIteration > 2) {
        const firstIterPath = join(iterationsPath, '1');
        if (existsSync(firstIterPath)) {
          try {
            const iteration = IterationManager.load(firstIterPath);
            const markdownFiles = iteration.getMarkdownFiles();

            previousIterations.push({
              number: 1,
              title: iteration.title,
              description: iteration.description,
              changes: markdownFiles.get('changes.md') || undefined,
            });
          } catch (error) {
            // Skip if can't be loaded
            if (VERBOSE) {
              console.error(
                `Failed to load iteration 1 for pre-context:`,
                error
              );
            }
          }
        }
      }

      // Always include the previous iteration (the one right before current)
      const prevIterNum = currentIteration - 1;
      const prevIterPath = join(iterationsPath, prevIterNum.toString());
      if (existsSync(prevIterPath)) {
        try {
          const iteration = IterationManager.load(prevIterPath);
          const markdownFiles = iteration.getMarkdownFiles();

          previousIterations.push({
            number: prevIterNum,
            title: iteration.title,
            description: iteration.description,
            changes: markdownFiles.get('changes.md') || undefined,
          });
        } catch (error) {
          // Skip if can't be loaded
          if (VERBOSE) {
            console.error(
              `Failed to load iteration ${prevIterNum} for pre-context:`,
              error
            );
          }
        }
      }
    }

    // Load current iteration data
    let currentIterationData: PreviousIteration | undefined = undefined;
    const currentIterPath = join(iterationsPath, currentIteration.toString());
    if (existsSync(currentIterPath)) {
      try {
        const iteration = IterationManager.load(currentIterPath);
        const markdownFiles = iteration.getMarkdownFiles();

        currentIterationData = {
          number: currentIteration,
          title: iteration.title,
          description: iteration.description,
          changes: markdownFiles.get('changes.md') || undefined,
        };
      } catch (error) {
        // If we can't load current iteration, continue without it
        if (VERBOSE) {
          console.error(
            `Failed to load current iteration ${currentIteration} for pre-context:`,
            error
          );
        }
      }
    }

    // Build pre-context data using PreContextDataManager
    const preContextManager = PreContextDataManager.create(
      this.taskDir,
      this.task.id.toString(),
      initialTask,
      previousIterations.length > 0 ? previousIterations : undefined,
      currentIterationData
    );

    // Return array with the single pre-context file
    // This allows for future expansion to support multiple files
    const preContextPath = join(this.taskDir, '__pre_context__.json');
    return [preContextPath];
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
  static generate(
    taskDescription: TaskDescriptionManager,
    agent: string
  ): string {
    const projectConfig = ProjectConfigManager.load();
    const builder = new SetupBuilder(taskDescription, agent, projectConfig);
    return builder.generateEntrypoint();
  }
}
