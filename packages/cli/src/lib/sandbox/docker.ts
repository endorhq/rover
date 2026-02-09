import { getAIAgentTool } from '../agents/index.js';
import { join } from 'node:path';
import {
  getDataDir,
  ProjectConfigManager,
  TaskDescriptionManager,
} from 'rover-core';
import { Sandbox, SandboxOptions } from './types.js';
import { SetupBuilder } from '../setup.js';
import { generateRandomId, launch, ProcessManager, VERBOSE } from 'rover-core';
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import {
  ContainerBackend,
  resolveAgentImage,
  warnIfCustomImage,
  tmpUserGroupFiles,
  normalizeExtraArgs,
} from './container-common.js';
import { checkImageCache, waitForInitAndCommit } from './image-cache.js';
import { mergeNetworkConfig } from '../network-config.js';
import { isJsonMode } from '../context.js';
import { isPathWithin } from '../../utils/path-utils.js';
import colors from 'ansi-colors';

export class DockerSandbox extends Sandbox {
  backend = ContainerBackend.Docker;

  private cacheTag?: string;
  private shouldCommitCache = false;
  private initMode = false;

  constructor(
    task: TaskDescriptionManager,
    processManager?: ProcessManager,
    options?: SandboxOptions
  ) {
    super(task, processManager, options);
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
    const projectConfig = ProjectConfigManager.load(this.options?.projectPath!);
    const worktreePath = this.task.worktreePath;

    // Validate worktree path is within project root or data directory (security check)
    const worktreeKnownLocation =
      isPathWithin(worktreePath, projectConfig.projectRoot) ||
      isPathWithin(worktreePath, getDataDir());

    if (worktreePath.length === 0 || !worktreeKnownLocation) {
      throw new Error(
        `Invalid worktree path for this project (${worktreePath})`
      );
    }

    // Resolve the agent image from env var, stored task image, config, or default
    const agentImage = resolveAgentImage(projectConfig, this.task.agentImage);

    // Check image cache
    const { hasCachedImage, cacheTag } = checkImageCache(
      ContainerBackend.Docker,
      projectConfig,
      agentImage,
      this.task.agent!
    );

    this.cacheTag = cacheTag;
    this.shouldCommitCache = !hasCachedImage;

    const effectiveImage = hasCachedImage ? cacheTag : agentImage;

    if (hasCachedImage && !isJsonMode()) {
      console.log(
        colors.green('Using cached setup image ') + colors.cyan(cacheTag)
      );
    }

    // Generate setup script using SetupBuilder
    const setupBuilder = new SetupBuilder(
      this.task,
      this.task.agent!,
      projectConfig
    );
    const entrypointScriptPath = setupBuilder.generateEntrypoint(
      true,
      'entrypoint.sh',
      hasCachedImage
    );
    const inputsPath = setupBuilder.generateInputs();
    const workflowPath = setupBuilder.saveWorkflow(this.task.workflowName);

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

    // Warn if using a custom agent image
    warnIfCustomImage(projectConfig);

    const [etcPasswd, etcGroup] = await tmpUserGroupFiles(
      ContainerBackend.Docker,
      effectiveImage,
      userInfo_
    );

    // Add NET_ADMIN capability if network filtering is configured
    const effectiveNetworkConfig = mergeNetworkConfig(
      projectConfig.network,
      this.task.networkConfig
    );
    if (effectiveNetworkConfig && effectiveNetworkConfig.mode !== 'allowall') {
      dockerArgs.push('--cap-add=NET_ADMIN');
    }

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

    // Mount context directory if available (read-only)
    const contextDir = join(iteration.iterationPath, 'context');
    const hasContext = existsSync(contextDir);
    if (hasContext) {
      dockerArgs.push('-v', `${contextDir}:/context:Z,ro`);
    }

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

    // Get extra args from CLI options and project config, merge them
    const configExtraArgs = normalizeExtraArgs(projectConfig?.sandboxExtraArgs);
    const cliExtraArgs = normalizeExtraArgs(this.options?.extraArgs);
    const extraArgs = [...configExtraArgs, ...cliExtraArgs];

    dockerArgs.push(
      ...envVariables,
      '-w',
      '/workspace',
      '--entrypoint',
      '/entrypoint.sh',
      ...extraArgs
    );

    if (this.initMode) {
      // Init-only container: run setup then exit successfully
      dockerArgs.push(effectiveImage, 'true');
    } else {
      dockerArgs.push(
        effectiveImage,
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

      // Pass context directory argument if context was mounted
      if (hasContext) {
        dockerArgs.push('--context-dir', '/context');
      }

      // Pass model if specified
      if (this.task.agentModel) {
        dockerArgs.push('--agent-model', this.task.agentModel);
      }

      // Forward verbose flag to rover-agent if enabled
      if (VERBOSE) {
        dockerArgs.push('-v');
      }
    }

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

  /**
   * Pre-compute image cache state so createAndStart() can decide
   * whether to run a two-phase init before calling create().
   */
  private checkCacheState(): void {
    const projectConfig = ProjectConfigManager.load(this.options?.projectPath!);
    const agentImage = resolveAgentImage(projectConfig, this.task.agentImage);

    const { hasCachedImage, cacheTag } = checkImageCache(
      ContainerBackend.Docker,
      projectConfig,
      agentImage,
      this.task.agent!
    );

    this.cacheTag = cacheTag;
    this.shouldCommitCache = !hasCachedImage;
  }

  async createAndStart(): Promise<string> {
    this.checkCacheState();

    if (this.shouldCommitCache && this.cacheTag) {
      // Phase 1: init-only container to build the cached image
      this.initMode = true;
      this.processManager?.addItem(
        `Initialize sandbox (${this.backend}) | Name: ${this.sandboxName}`
      );
      try {
        await this.create();
        this.processManager?.completeLastItem();
        this.processManager?.addItem(
          `Run initialization (${this.backend}) | Name: ${this.sandboxName}`
        );
        await this.start();
        const committed = await waitForInitAndCommit(
          ContainerBackend.Docker,
          this.sandboxName,
          this.cacheTag
        );
        this.processManager?.completeLastItem();

        if (!committed) {
          this.processManager?.finish();
          throw new Error('Init container did not exit successfully');
        }
      } catch (err) {
        this.processManager?.failLastItem();
        this.processManager?.finish();
        throw err;
      }

      // Phase 2: create + start the real container from cached image
      this.initMode = false;
      this.shouldCommitCache = false;
      this.cacheTag = undefined;
    }

    // Cache-hit path (or phase 2 after init)
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

  async runInteractive(
    initialPrompt?: string
  ): Promise<ReturnType<typeof launch>> {
    // Start Docker container with direct stdio inheritance
    const iteration = this.task.getLastIteration();

    if (!iteration) {
      throw new Error('No iteration data found for this task');
    }

    // Load project configuration
    const projectConfig = ProjectConfigManager.load(this.options?.projectPath!);
    const worktreePath = this.task.worktreePath;

    // Validate worktree path is within project root or data directory (security check)
    const worktreeKnownLocation =
      isPathWithin(worktreePath, projectConfig.projectRoot) ||
      isPathWithin(worktreePath, getDataDir());

    if (worktreePath.length === 0 || !worktreeKnownLocation) {
      throw new Error(
        `Invalid worktree path for this project (${worktreePath})`
      );
    }

    // Resolve the agent image from env var, stored task image, config, or default
    const agentImage = resolveAgentImage(projectConfig, this.task.agentImage);

    // Check image cache for interactive mode
    const { hasCachedImage, cacheTag } = checkImageCache(
      ContainerBackend.Docker,
      projectConfig,
      agentImage,
      this.task.agent!
    );

    const effectiveImage = hasCachedImage ? cacheTag : agentImage;

    if (hasCachedImage && !isJsonMode()) {
      console.log(
        colors.green('Using cached setup image ') + colors.cyan(cacheTag)
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
      'entrypoint-iterate.sh',
      hasCachedImage
    );
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

    // Warn if using a custom agent image
    warnIfCustomImage(projectConfig);

    const [etcPasswd, etcGroup] = await tmpUserGroupFiles(
      ContainerBackend.Docker,
      effectiveImage,
      userInfo_
    );

    // Add NET_ADMIN capability if network filtering is configured
    const effectiveNetworkConfigInteractive = mergeNetworkConfig(
      projectConfig.network,
      this.task.networkConfig
    );
    if (
      effectiveNetworkConfigInteractive &&
      effectiveNetworkConfigInteractive.mode !== 'allowall'
    ) {
      dockerArgs.push('--cap-add=NET_ADMIN');
    }

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

    // Mount context directory if available (read-only)
    const contextDir = join(iteration.iterationPath, 'context');
    const hasContext = existsSync(contextDir);
    if (hasContext) {
      dockerArgs.push('-v', `${contextDir}:/context:Z,ro`);
    }

    // Get extra args from CLI options and project config, merge them
    const configExtraArgs = normalizeExtraArgs(projectConfig?.sandboxExtraArgs);
    const cliExtraArgs = normalizeExtraArgs(this.options?.extraArgs);
    const extraArgs = [...configExtraArgs, ...cliExtraArgs];

    dockerArgs.push(
      ...envVariables,
      '-w',
      '/workspace',
      '--entrypoint',
      '/entrypoint.sh',
      ...extraArgs,
      effectiveImage,
      'rover-agent',
      'session',
      this.task.agent!
    );

    if (initialPrompt) {
      dockerArgs.push(initialPrompt);
    }

    // Pass context directory argument if context was mounted
    if (hasContext) {
      dockerArgs.push('--context-dir', '/context');
    }

    // Pass model if specified
    if (this.task.agentModel) {
      dockerArgs.push('--agent-model', this.task.agentModel);
    }

    // Forward verbose flag to rover-agent if enabled
    if (VERBOSE) {
      dockerArgs.push('-v');
    }

    // Use detached: false to ensure proper TTY signal handling and job control
    return launch('docker', dockerArgs, {
      stdio: 'inherit',
      reject: false,
      detached: false,
    });
  }

  /**
   * Get the environment object with DOCKER_HOST set if available from options.
   */
  private getDockerEnv(): NodeJS.ProcessEnv {
    const dockerHost = this.options?.sandboxMetadata?.dockerHost;
    if (typeof dockerHost === 'string') {
      return { ...process.env, DOCKER_HOST: dockerHost };
    }
    return process.env;
  }

  protected async remove(): Promise<string> {
    return (
      (
        await launch('docker', ['rm', '-f', this.sandboxName], {
          env: this.getDockerEnv(),
        })
      ).stdout
        ?.toString()
        .trim() || this.sandboxName
    );
  }

  protected async stop(): Promise<string> {
    return (
      (
        await launch('docker', ['stop', this.sandboxName], {
          env: this.getDockerEnv(),
        })
      ).stdout
        ?.toString()
        .trim() || this.sandboxName
    );
  }

  protected async logs(): Promise<string> {
    return (
      (
        await launch('docker', ['logs', this.sandboxName], {
          env: this.getDockerEnv(),
        })
      ).stdout?.toString() || ''
    );
  }

  protected async *followLogs(): AsyncIterable<string> {
    const process = launch('docker', ['logs', '--follow', this.sandboxName], {
      env: this.getDockerEnv(),
    });

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

    // Get extra args from CLI options and project config, merge them
    const projectConfig = ProjectConfigManager.load(this.options?.projectPath!);
    const configExtraArgs = normalizeExtraArgs(projectConfig?.sandboxExtraArgs);
    const cliExtraArgs = normalizeExtraArgs(this.options?.extraArgs);
    const extraArgs = [...configExtraArgs, ...cliExtraArgs];

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
      ...extraArgs,
      'node:lts',
      '/bin/bash',
    ];

    // Start Docker container with direct stdio inheritance for true interactivity
    // Use detached: false to ensure proper TTY signal handling and job control
    await launch('docker', dockerArgs, {
      reject: false,
      stdio: 'inherit', // This gives full control to the user
      detached: false,
    });
  }
}
