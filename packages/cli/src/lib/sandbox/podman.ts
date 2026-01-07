import { getAIAgentTool } from '../agents/index.js';
import { join } from 'node:path';
import { ProjectConfigManager } from 'rover-schemas';
import { Sandbox } from './types.js';
import { SetupBuilder } from '../setup.js';
import { TaskDescriptionManager } from 'rover-schemas';
import { findProjectRoot, launch, ProcessManager, VERBOSE } from 'rover-core';
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import { generateRandomId } from '../../utils/branch-name.js';
import {
  ContainerBackend,
  resolveAgentImage,
  warnIfCustomImage,
  tmpUserGroupFiles,
} from './container-common.js';
import { isJsonMode } from '../global-state.js';
import colors from 'ansi-colors';

export class PodmanSandbox extends Sandbox {
  backend = ContainerBackend.Podman;

  constructor(task: TaskDescriptionManager, processManager?: ProcessManager) {
    super(task, processManager);
  }

  /**
   * Collect all unique agents that will be used in the workflow.
   * This includes the default agent and any per-step agent overrides.
   */
  private collectUniqueAgents(): string[] {
    const agents = new Set<string>();
    agents.add(this.task.agent!);
    if (this.task.stepAgents) {
      for (const config of Object.values(this.task.stepAgents)) {
        if (config.tool) agents.add(config.tool);
      }
    }
    return Array.from(agents);
  }

  async isBackendAvailable(): Promise<boolean> {
    try {
      await launch('podman', ['--version']);
      return true;
    } catch (error) {
      return false;
    }
  }

  protected async create(): Promise<string> {
    const iteration = this.task.getLastIteration();

    if (!iteration) {
      throw new Error('No iteration data found for this task');
    }

    // Load project configuration
    const projectConfig = ProjectConfigManager.load();
    const worktreePath = this.task.worktreePath;

    if (
      worktreePath.length === 0 ||
      !worktreePath.startsWith(projectConfig.projectRoot)
    ) {
      throw new Error(
        `Invalid worktree path for this project (${worktreePath})`
      );
    }

    // Collect all unique agents (default + per-step overrides)
    const allAgents = this.collectUniqueAgents();

    // Generate setup script using SetupBuilder
    const setupBuilder = new SetupBuilder(this.task, allAgents, projectConfig);
    const entrypointScriptPath = setupBuilder.generateEntrypoint();
    const inputsPath = setupBuilder.generateInputs();
    const workflowPath = setupBuilder.saveWorkflow(this.task.workflowName);
    const preContextPaths = setupBuilder.generatePreContextFiles();

    // Get container mounts and environment variables for ALL agents
    const containerMounts: string[] = [];
    const envVariables: string[] = [];
    for (const agentName of allAgents) {
      const agent = getAIAgentTool(agentName);
      containerMounts.push(...agent.getContainerMounts());
      envVariables.push(
        ...this.getSandboxEnvironmentVariables(agent, projectConfig)
      );
    }
    // Remove duplicates from mounts and env vars
    // Mounts come as pairs ['-v', 'path1', '-v', 'path2'], so deduplicate by mount path
    const seenMounts = new Set<string>();
    const uniqueMounts: string[] = [];
    for (let i = 0; i < containerMounts.length; i += 2) {
      const flag = containerMounts[i];
      const mount = containerMounts[i + 1];
      if (mount && !seenMounts.has(mount)) {
        seenMounts.add(mount);
        uniqueMounts.push(flag, mount);
      }
    }
    const uniqueEnvVars = [...new Set(envVariables)];

    // Clean up any existing container with same name
    try {
      await launch('podman', ['rm', '-f', this.sandboxName]);
    } catch (error) {
      // Container doesn't exist, which is fine
    }

    const podmanArgs = ['create', '--name', this.sandboxName];

    const userInfo_ = userInfo();

    // Resolve the agent image from env var, stored task image, config, or default
    const agentImage = resolveAgentImage(projectConfig, this.task.agentImage);
    // Warn if using a custom agent image
    warnIfCustomImage(projectConfig);

    const [etcPasswd, etcGroup] = await tmpUserGroupFiles(
      ContainerBackend.Podman,
      agentImage,
      userInfo_
    );

    podmanArgs.push(
      '-v',
      `${etcPasswd}:/etc/passwd:Z,ro`,
      '-v',
      `${etcGroup}:/etc/group:Z,ro`,
      '--user',
      `${userInfo_.uid}:${userInfo_.gid}`,
      '-v',
      `${worktreePath}:/workspace:Z,rw`,
      '-v',
      `${iteration.iterationPath}:/output:Z,rw`,
      ...uniqueMounts,
      '-v',
      `${entrypointScriptPath}:/entrypoint.sh:Z,ro`,
      '-v',
      `${workflowPath}:/workflow.yml:Z,ro`,
      '-v',
      `${inputsPath}:/inputs.json:Z,ro`,
      '-v',
      `${iteration.fileDescriptionPath}:/task/description.json:Z,ro`
    );

    // Mount pre-context files
    preContextPaths.forEach((preContextPath, index) => {
      podmanArgs.push(
        '-v',
        `${preContextPath}:/__pre_context_${index}__.json:Z,ro`
      );
    });

    // Mount initScript if provided in project config
    if (projectConfig?.initScript) {
      const initScriptAbsPath = join(
        projectConfig.projectRoot,
        projectConfig.initScript
      );
      if (existsSync(initScriptAbsPath)) {
        podmanArgs.push('-v', `${initScriptAbsPath}:/init-script.sh:Z,ro`);
      } else if (!isJsonMode()) {
        console.log(
          colors.yellow(
            `⚠ Warning: initScript '${projectConfig.initScript}' does not exist`
          )
        );
      }
    }

    podmanArgs.push(
      ...uniqueEnvVars,
      '-w',
      '/workspace',
      '--entrypoint',
      '/entrypoint.sh',
      agentImage,
      'rover-agent',
      'run',
      '/workflow.yml',
      '--agent-tool',
      this.task.agent!,
      '--task-id',
      this.task.id.toString(),
      '--status-file',
      '/output/status.json',
      '--output',
      '/output',
      '--inputs-json',
      '/inputs.json'
    );

    // Pass model if specified
    if (this.task.agentModel) {
      podmanArgs.push('--agent-model', this.task.agentModel);
    }

    // Pass step agents if specified
    if (this.task.stepAgents && Object.keys(this.task.stepAgents).length > 0) {
      podmanArgs.push('--step-agents', JSON.stringify(this.task.stepAgents));
    }

    // Forward verbose flag to rover-agent if enabled
    if (VERBOSE) {
      podmanArgs.push('-v');
    }

    // Add pre-context file arguments
    preContextPaths.forEach((_, index) => {
      podmanArgs.push('--pre-context-file', `/__pre_context_${index}__.json`);
    });

    return (
      (await launch('podman', podmanArgs)).stdout?.toString().trim() ||
      this.sandboxName
    );
  }

  protected async start(): Promise<string> {
    return (
      (
        await launch('podman', ['start', this.sandboxName], { stdio: 'pipe' })
      ).stdout
        ?.toString()
        .trim() || this.sandboxName
    );
  }

  async runInteractive(
    initialPrompt?: string
  ): Promise<ReturnType<typeof launch>> {
    // Start Podman container with direct stdio inheritance
    const iteration = this.task.getLastIteration();

    if (!iteration) {
      throw new Error('No iteration data found for this task');
    }

    // Load project configuration
    const projectConfig = ProjectConfigManager.load();
    const worktreePath = this.task.worktreePath;

    if (
      worktreePath.length === 0 ||
      !worktreePath.startsWith(projectConfig.projectRoot)
    ) {
      throw new Error(
        `Invalid worktree path for this project (${worktreePath})`
      );
    }

    // Collect all unique agents (default + per-step overrides)
    const allAgents = this.collectUniqueAgents();

    // Generate setup script using SetupBuilder
    const setupBuilder = new SetupBuilder(this.task, allAgents, projectConfig);
    const entrypointScriptPath = setupBuilder.generateEntrypoint(
      false,
      'entrypoint-iterate.sh'
    );
    const preContextPaths = setupBuilder.generatePreContextFiles();

    // Get container mounts and environment variables for ALL agents
    const containerMounts: string[] = [];
    const envVariables: string[] = [];
    for (const agentName of allAgents) {
      const agent = getAIAgentTool(agentName);
      containerMounts.push(...agent.getContainerMounts());
      envVariables.push(
        ...this.getSandboxEnvironmentVariables(agent, projectConfig)
      );
    }
    // Remove duplicates from mounts and env vars
    // Mounts come as pairs ['-v', 'path1', '-v', 'path2'], so deduplicate by mount path
    const seenMounts = new Set<string>();
    const uniqueMounts: string[] = [];
    for (let i = 0; i < containerMounts.length; i += 2) {
      const flag = containerMounts[i];
      const mount = containerMounts[i + 1];
      if (mount && !seenMounts.has(mount)) {
        seenMounts.add(mount);
        uniqueMounts.push(flag, mount);
      }
    }
    const uniqueEnvVars = [...new Set(envVariables)];

    const interactiveName = `${this.sandboxName}-i`;
    const podmanArgs = ['run', '--name', interactiveName, '-it', '--rm'];

    const userInfo_ = userInfo();

    // Resolve the agent image from env var, stored task image, config, or default
    const agentImage = resolveAgentImage(projectConfig, this.task.agentImage);
    // Warn if using a custom agent image
    warnIfCustomImage(projectConfig);

    const [etcPasswd, etcGroup] = await tmpUserGroupFiles(
      ContainerBackend.Podman,
      agentImage,
      userInfo_
    );

    podmanArgs.push(
      '-v',
      `${etcPasswd}:/etc/passwd:Z,ro`,
      '-v',
      `${etcGroup}:/etc/group:Z,ro`,
      '--user',
      `${userInfo_.uid}:${userInfo_.gid}`,
      '-v',
      `${worktreePath}:/workspace:Z,rw`,
      '-v',
      `${iteration.iterationPath}:/output:Z,rw`,
      ...uniqueMounts,
      '-v',
      `${entrypointScriptPath}:/entrypoint.sh:Z,ro`
    );

    // Mount pre-context files
    preContextPaths.forEach((preContextPath, index) => {
      podmanArgs.push(
        '-v',
        `${preContextPath}:/__pre_context_${index}__.json:Z,ro`
      );
    });

    podmanArgs.push(
      ...uniqueEnvVars,
      '-w',
      '/workspace',
      '--entrypoint',
      '/entrypoint.sh',
      agentImage,
      'rover-agent',
      'session',
      this.task.agent!
    );

    if (initialPrompt) {
      podmanArgs.push(initialPrompt);
    }

    // Pass model if specified
    if (this.task.agentModel) {
      podmanArgs.push('--agent-model', this.task.agentModel);
    }

    // Pass step agents if specified
    if (this.task.stepAgents && Object.keys(this.task.stepAgents).length > 0) {
      podmanArgs.push('--step-agents', JSON.stringify(this.task.stepAgents));
    }

    // Forward verbose flag to rover-agent if enabled
    if (VERBOSE) {
      podmanArgs.push('-v');
    }

    // Add pre-context file arguments
    preContextPaths.forEach((_, index) => {
      podmanArgs.push('--pre-context-file', `/__pre_context_${index}__.json`);
    });

    return launch('podman', podmanArgs, { stdio: 'inherit', reject: false });
  }

  protected async remove(): Promise<string> {
    return (
      (
        await launch('podman', ['rm', '-f', this.sandboxName], {
          stdio: 'pipe',
        })
      ).stdout
        ?.toString()
        .trim() || this.sandboxName
    );
  }

  protected async stop(): Promise<string> {
    return (
      (
        await launch('podman', ['stop', this.sandboxName], { stdio: 'pipe' })
      ).stdout
        ?.toString()
        .trim() || this.sandboxName
    );
  }

  protected async logs(): Promise<string> {
    return (
      (
        await launch('podman', ['logs', this.sandboxName], { stdio: 'pipe' })
      ).stdout?.toString() || ''
    );
  }

  protected async *followLogs(): AsyncIterable<string> {
    const process = launch('podman', ['logs', '--follow', this.sandboxName]);

    if (!process.stdout) {
      return;
    }

    // Stream stdout line by line
    for await (const chunk of process.stdout) {
      yield chunk.toString();
    }
  }

  async openShellAtWorktree(): Promise<void> {
    // Check if worktree exists
    if (!this.task.worktreePath || !existsSync(this.task.worktreePath)) {
      throw new Error('No worktree found for this task');
    }

    // Generate a unique container name for the interactive shell
    const containerName = `rover-shell-${this.task.id}-${generateRandomId()}`;

    // Build Podman run command for interactive shell
    const podmanArgs = [
      'run',
      '--rm', // Remove container when it exits
      '-it', // Interactive with TTY
      '--name',
      containerName,
      '-v',
      `${this.task.worktreePath}:/workspace:Z,rw`,
      '-w',
      '/workspace',
      'node:24-alpine',
      '/bin/sh',
    ];

    // Start Podman container with direct stdio inheritance for true interactivity
    await launch('podman', podmanArgs, {
      reject: false,
      stdio: 'inherit', // This gives full control to the user
    });
  }
}
