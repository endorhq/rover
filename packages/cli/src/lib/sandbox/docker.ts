import { getAIAgentTool } from '../agents/index.js';
import { join } from 'node:path';
import { ProjectConfigManager } from 'rover-schemas';
import { Sandbox } from './types.js';
import { SetupBuilder } from '../setup.js';
import { TaskDescriptionManager } from 'rover-schemas';
import { launch, ProcessManager, VERBOSE } from 'rover-core';
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

export class DockerSandbox extends Sandbox {
  backend = ContainerBackend.Docker;

  constructor(task: TaskDescriptionManager, processManager?: ProcessManager) {
    super(task, processManager);
  }

  async isBackendAvailable(): Promise<boolean> {
    try {
      // Check if docker command exists and verify it's actual Docker (not Podman)
      const result = await launch('docker', ['info', '--format', 'json']);
      const info = JSON.parse(result.stdout?.toString() || '{}');

      // Docker will have ServerVersion set, Podman (even aliased as docker) will not
      return info.ServerVersion != null;
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

    // Generate setup script using SetupBuilder
    const setupBuilder = new SetupBuilder(
      this.task,
      this.task.agent!,
      projectConfig
    );
    const entrypointScriptPath = setupBuilder.generateEntrypoint();
    const inputsPath = setupBuilder.generateInputs();
    const workflowPath = setupBuilder.saveWorkflow(this.task.workflowName);
    const preContextPaths = setupBuilder.generatePreContextFiles();

    // Get agent-specific Docker mounts and environment variables
    const agent = getAIAgentTool(this.task.agent!);
    const dockerMounts: string[] = agent.getContainerMounts();
    const envVariables: string[] = this.getSandboxEnvironmentVariables(
      agent,
      projectConfig
    );

    // Clean up any existing container with same name
    try {
      await launch('docker', ['rm', '-f', this.sandboxName]);
    } catch (error) {
      // Container doesn't exist, which is fine
    }

    const dockerArgs = ['create', '--name', this.sandboxName];

    const userInfo_ = userInfo();

    // If we cannot retrieve the UID in the current environment,
    // set it to 1000, so that the Rover agent container will be
    // using this unprivileged UID. This happens typically on
    // environments such as Windows.
    if (userInfo_.uid === -1) {
      userInfo_.uid = 1000;
    }

    // If we cannot retrieve the GID in the current environment,
    // set it to 1000, so that the Rover agent container will be
    // using this unprivileged GID. This happens typically on
    // environments such as Windows.
    if (userInfo_.gid === -1) {
      userInfo_.gid = 1000;
    }

    // Resolve the agent image from env var, stored task image, config, or default
    const agentImage = resolveAgentImage(projectConfig, this.task.agentImage);

    // Warn if using a custom agent image
    warnIfCustomImage(projectConfig);

    const [etcPasswd, etcGroup] = await tmpUserGroupFiles(
      ContainerBackend.Docker,
      agentImage,
      userInfo_
    );

    dockerArgs.push(
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
      ...dockerMounts,
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
      dockerArgs.push(
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
        dockerArgs.push('-v', `${initScriptAbsPath}:/init-script.sh:Z,ro`);
      } else if (!isJsonMode()) {
        console.log(
          colors.yellow(
            `⚠ Warning: initScript '${projectConfig.initScript}' does not exist`
          )
        );
      }
    }

    dockerArgs.push(
      ...envVariables,
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

    // Forward verbose flag to rover-agent if enabled
    if (VERBOSE) {
      dockerArgs.push('-v');
    }

    // Add pre-context file arguments
    preContextPaths.forEach((_, index) => {
      dockerArgs.push('--pre-context-file', `/__pre_context_${index}__.json`);
    });

    return (
      (await launch('docker', dockerArgs)).stdout?.toString().trim() ||
      this.sandboxName
    );
  }

  protected async start(): Promise<string> {
    return (
      (await launch('docker', ['start', this.sandboxName])).stdout
        ?.toString()
        .trim() || this.sandboxName
    );
  }

  async runInteractive(
    initialPrompt?: string
  ): Promise<ReturnType<typeof launch>> {
    // Start Docker container with direct stdio inheritance
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

    // Generate setup script using SetupBuilder
    const setupBuilder = new SetupBuilder(
      this.task,
      this.task.agent!,
      projectConfig
    );
    const entrypointScriptPath = setupBuilder.generateEntrypoint(
      false,
      'entrypoint-iterate.sh'
    );
    const preContextPaths = setupBuilder.generatePreContextFiles();

    // Get agent-specific Docker mounts and environment variables
    const agent = getAIAgentTool(this.task.agent!);
    const dockerMounts: string[] = agent.getContainerMounts();
    const envVariables: string[] = this.getSandboxEnvironmentVariables(
      agent,
      projectConfig
    );

    const interactiveName = `${this.sandboxName}-i`;
    const dockerArgs = ['run', '--name', interactiveName, '-it', '--rm'];

    const userInfo_ = userInfo();

    // If we cannot retrieve the UID in the current environment,
    // set it to 1000, so that the Rover agent container will be
    // using this unprivileged UID. This happens typically on
    // environments such as Windows.
    if (userInfo_.uid === -1) {
      userInfo_.uid = 1000;
    }

    // If we cannot retrieve the GID in the current environment,
    // set it to 1000, so that the Rover agent container will be
    // using this unprivileged GID. This happens typically on
    // environments such as Windows.
    if (userInfo_.gid === -1) {
      userInfo_.gid = 1000;
    }

    // Resolve the agent image from env var, stored task image, config, or default
    const agentImage = resolveAgentImage(projectConfig, this.task.agentImage);

    // Warn if using a custom agent image
    warnIfCustomImage(projectConfig);

    const [etcPasswd, etcGroup] = await tmpUserGroupFiles(
      ContainerBackend.Docker,
      agentImage,
      userInfo_
    );

    dockerArgs.push(
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
      ...dockerMounts,
      '-v',
      `${entrypointScriptPath}:/entrypoint.sh:Z,ro`
    );

    // Mount pre-context files
    preContextPaths.forEach((preContextPath, index) => {
      dockerArgs.push(
        '-v',
        `${preContextPath}:/__pre_context_${index}__.json:Z,ro`
      );
    });

    dockerArgs.push(
      ...envVariables,
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
      dockerArgs.push(initialPrompt);
    }

    // Forward verbose flag to rover-agent if enabled
    if (VERBOSE) {
      dockerArgs.push('-v');
    }

    // Add pre-context file arguments
    preContextPaths.forEach((_, index) => {
      dockerArgs.push('--pre-context-file', `/__pre_context_${index}__.json`);
    });

    return launch('docker', dockerArgs, { stdio: 'inherit', reject: false });
  }

  protected async remove(): Promise<string> {
    return (
      (await launch('docker', ['rm', '-f', this.sandboxName])).stdout
        ?.toString()
        .trim() || this.sandboxName
    );
  }

  protected async stop(): Promise<string> {
    return (
      (await launch('docker', ['stop', this.sandboxName])).stdout
        ?.toString()
        .trim() || this.sandboxName
    );
  }

  protected async logs(): Promise<string> {
    return (
      (await launch('docker', ['logs', this.sandboxName])).stdout?.toString() ||
      ''
    );
  }

  protected async *followLogs(): AsyncIterable<string> {
    const process = launch('docker', ['logs', '--follow', this.sandboxName]);

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

    // Build Docker run command for interactive shell
    const dockerArgs = [
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

    // Start Docker container with direct stdio inheritance for true interactivity
    await launch('docker', dockerArgs, {
      reject: false,
      stdio: 'inherit', // This gives full control to the user
    });
  }
}
