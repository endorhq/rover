import {
  writeFileSync,
  chmodSync,
  mkdirSync,
  cpSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  TaskDescriptionManager,
  IterationManager,
  PreContextDataManager,
  ProjectConfigManager,
  launchSync,
  VERBOSE,
} from 'rover-core';
import type { PreviousIteration } from 'rover-schemas';
import entrypointScript from './entrypoint.sh';
import pupa from 'pupa';
import type { SandboxPackage } from './sandbox/types.js';
import { mergeNetworkConfig, generateNetworkScript } from './network-config.js';
import { initWorkflowStore } from './workflow.js';

// Language packages
import { JavaScriptSandboxPackage } from './sandbox/languages/javascript.js';
import { TypeScriptSandboxPackage } from './sandbox/languages/typescript.js';
import { PHPSandboxPackage } from './sandbox/languages/php.js';
import { RustSandboxPackage } from './sandbox/languages/rust.js';
import { GoSandboxPackage } from './sandbox/languages/go.js';
import { PythonSandboxPackage } from './sandbox/languages/python.js';
import { RubySandboxPackage } from './sandbox/languages/ruby.js';
import { DartSandboxPackage } from './sandbox/languages/dart.js';

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
import { PubSandboxPackage } from './sandbox/package-managers/pub.js';

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
  private taskBasePath: string;
  private iterationPath: string;
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

    // Set up paths using TaskDescriptionManager methods
    this.taskBasePath = this.task.getBasePath();
    this.iterationPath = this.task.getIterationPath();

    // Ensures the directories exist
    mkdirSync(this.iterationPath, { recursive: true });
  }

  /**
   * Get language sandbox packages based on project configuration
   */
  private getLanguagePackages(): SandboxPackage[] {
    const packages: SandboxPackage[] = [];

    for (const language of this.projectConfig.languages ?? []) {
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
        case 'dart':
          packages.push(new DartSandboxPackage());
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

    for (const packageManager of this.projectConfig.packageManagers ?? []) {
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
        case 'pub':
          packages.push(new PubSandboxPackage());
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

    for (const taskManager of this.projectConfig.taskManagers ?? []) {
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
    entrypointFilename: string = 'entrypoint.sh',
    useCachedImage: boolean = false
  ): string {
    let recoverPermissions = '';

    // For Docker rootless, force it to return the permissions to the right users.
    if (this.isDockerRootless) {
      recoverPermissions = `\n    sudo chown -R root:root /workspace || true
    sudo chown -R root:root /output || true\n`;
    }

    // --- apt-get update ---
    let aptGetUpdate = '';
    if (!useCachedImage) {
      aptGetUpdate = `# Update package lists on Debian-based distributions
if [[ -f /etc/debian_version ]]; then
  sudo apt-get update
fi`;
    }

    // --- home setup ---
    let homeSetup = '';
    if (useCachedImage) {
      // Cached image already has HOME dirs; just fix ownership of bind-mounts
      homeSetup = `sudo chown -R $(id -u):$(id -g) /workspace
sudo chown -R $(id -u):$(id -g) /output

source $HOME/.profile`;
    } else {
      homeSetup = `# Initially, use sudo to ensure even users without permissions can
# create this. Once we finish the setup, we will reduce the sudo
# permissions to the minimal.
sudo mkdir -p $HOME
sudo mkdir -p $HOME/.config
sudo mkdir -p $HOME/.local/bin
echo 'export PATH="$HOME/.local/bin:$HOME/.local/npm/bin:$PATH"' >> $HOME/.profile
sudo chown -R $(id -u):$(id -g) $HOME
sudo chown -R $(id -u):$(id -g) /logs
sudo chown -R $(id -u):$(id -g) /output
sudo chown -R $(id -u):$(id -g) /workspace

source $HOME/.profile`;
    }

    // --- package installation ---
    let installAllPackages = '';
    if (!useCachedImage) {
      // Generate installation scripts for languages, package managers, and task managers
      const languagePackages = this.getLanguagePackages();
      const packageManagerPackages = this.getPackageManagerPackages();
      const taskManagerPackages = this.getTaskManagerPackages();

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
    }

    // --- agent install section ---
    let agentInstallSection = '';
    if (!useCachedImage) {
      agentInstallSection = `# Agent-specific CLI installation and credential setup
echo -e "\\n📦 Installing Agent CLI and setting up credentials"
# Pass the environment variables to ensure it loads the right credentials
sudo rover-agent install $AGENT
# Set the right permissions after installing and moving credentials
sudo chown -R $(id -u):$(id -g) $HOME

if [ $? -eq 0 ]; then
    echo "✅ $AGENT was installed successfully."
else
    echo "❌ $AGENT could not be installed"
    safe_exit 1
fi

echo -e "\\n📦 Done installing agent"`;
    }

    // --- credential install section ---
    // Always copy credentials on every container start (including cached images)
    // so that fresh credentials are available even when the image was cached.
    const credentialInstallSection = `# Copy credentials (runs on every start, including cached images)
echo -e "\\n📦 Copying agent credentials"
sudo rover-agent-install $AGENT
sudo chown -R $(id -u):$(id -g) $HOME
echo "✅ Credentials copied successfully"`;

    // --- MCP config section ---
    let mcpConfigSection = '';
    if (!useCachedImage) {
      // Generate MCP configuration commands from rover.json
      const mcps = this.projectConfig.mcps;
      let configureAllMCPCommands: string[] = [];

      if (mcps && mcps.length > 0) {
        configureAllMCPCommands.push('echo "✅ Configuring custom MCPs"');
        for (const mcp of mcps) {
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

      mcpConfigSection = `echo -e "\\n📦 Installing MCP servers"
# Configure built-in MCPs
rover-agent config mcp $AGENT package-manager --transport "http" http://127.0.0.1:8090/mcp

# Configure MCPs from rover.json if mcps array exists
#
# TODO(ereslibre): replace with \`rover-agent config mcps\` that by
# default will read /workspace/rover.json.
configure_all_mcps() {
  # Fail as soon as the configuration of one of the provided MCP's
  # fail. This is because results might not be close to what the user
  # expects without the required MCP's.

  set -e
  trap 'warn_mcp_configuration_failed; return 1' ERR

  ${configureAllMCPCommands.join('\n  ')}

  trap - ERR
  set +e
}

warn_mcp_configuration_failed() {
  echo "❌ Failed to configure MCP servers"
  safe_exit 1
}

configure_all_mcps

echo -e "\\n📦 Done installing MCP servers"`;
    }

    // --- initScript execution ---
    let initScriptExecution = '';
    if (!useCachedImage && this.projectConfig.initScript) {
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

    // --- sudoers removal ---
    // Only needed on the first (non-cached) run. The committed image already
    // has this file removed, so the cached image only has the base-image
    // sudoers profile with restricted permissions.
    const sudoersRemoval = useCachedImage
      ? ''
      : `# Remove ourselves from sudoers
echo -e "\\n👤 Removing privileges after completing the setup!"
sudo rm /etc/sudoers.d/1-agent-setup`;

    // Generate network filtering configuration (always runs — iptables are runtime state)
    const effectiveNetworkConfig = mergeNetworkConfig(
      this.projectConfig.network,
      this.task.networkConfig
    );
    const networkConfigSection = generateNetworkScript(effectiveNetworkConfig);

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
      recoverPermissions,
      aptGetUpdate,
      homeSetup,
      installAllPackages,
      agentInstallSection,
      credentialInstallSection,
      mcpConfigSection,
      initScriptExecution,
      sudoersRemoval,
      networkConfigSection,
      validateTaskFileFunction,
      validateTaskFileCall,
      taskDataSection,
      exportTaskVariables,
      workflowExecutionSection,
    });

    // Write script to file
    const scriptPath = join(this.iterationPath, entrypointFilename);
    writeFileSync(scriptPath, scriptContent.replace(/\r\n/g, '\n'), 'utf8');

    // Make script executable
    chmodSync(scriptPath, 0o755);

    return scriptPath;
  }

  /**
   * Generate the inputs file to store task inputs and simplify loading them.
   */
  generateInputs(): string {
    // Use the current iteration's expanded title/description when available,
    // falling back to the original task-level values for the first iteration.
    const currentIteration = this.task.getLastIteration();
    const inputs = {
      title: currentIteration?.title ?? this.task.title,
      description: currentIteration?.description ?? this.task.description,
    };

    const inputsPath = join(this.iterationPath, 'inputs.json');
    writeFileSync(inputsPath, JSON.stringify(inputs, null, 2), 'utf-8');

    return inputsPath;
  }

  /**
   * Save the workflow file into the target task.
   */
  saveWorkflow(workflowName: string): string {
    // Write workflow file to task base path (workflow cannot change between iterations)
    const workflowTaskPath = join(this.taskBasePath, 'workflow.yml');
    const workflowStore = initWorkflowStore(this.projectConfig.projectRoot);
    const workflow = workflowStore.getWorkflow(workflowName);

    if (!workflow) {
      throw new Error(`Workflow '${workflowName}' not found`);
    }

    cpSync(workflow.filePath, workflowTaskPath);

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
      this.iterationPath,
      this.task.id.toString(),
      initialTask,
      previousIterations.length > 0 ? previousIterations : undefined,
      currentIterationData
    );

    // Return array with the single pre-context file
    // This allows for future expansion to support multiple files
    const preContextPath = join(this.iterationPath, '__pre_context__.json');
    return [preContextPath];
  }

  /**
   * Get the path for an iteration-specific script file
   */
  getScriptPath(script: string): string {
    return join(this.iterationPath, script);
  }

  /**
   * Get the path for a task-level file (not iteration-specific)
   */
  getTaskFilePath(filename: string): string {
    return join(this.taskBasePath, filename);
  }

  /**
   * Static factory method to create and generate setup script
   */
  static generate(
    taskDescription: TaskDescriptionManager,
    agent: string,
    projectPath: string
  ): string {
    const projectConfig = ProjectConfigManager.load(projectPath);
    const builder = new SetupBuilder(taskDescription, agent, projectConfig);
    return builder.generateEntrypoint();
  }
}
